import { makeRng } from '../rng'
import { mixHex, withAlpha } from '../palette'
import { bounds, flatten, toPath2D, walk, OP } from '../scene/path'
import type { Path } from '../scene/path'
import type { Geom, Node, SceneGraph } from '../scene/types'
import type { RenderContext } from '../types'
import type { LayoutPlan } from '../layout'
import type { Character } from '../character'
import { applyLut, lutFor } from './grade'
import { applyFilm, drawDust } from './film'

/**
 * The post pipeline.
 *
 * Everything that used to be a renderer's problem, done once. Depth sorting,
 * contact darkening, cast shadows with penumbra, depth of field, material
 * resolution, bloom, halation, grade and film — all of it driven off the two
 * numbers a node carries, `plane` and `tone`, plus its material.
 *
 * Two costs are worth stating because they shape the whole design.
 *
 * A blur is priced per region, not per element, so the passes are organised
 * around blurring a small fixed number of large buffers rather than many small
 * ones. Three depth tiers, one shadow buffer per tier, one bloom buffer. That
 * is seven blurs for a composition of any size, and it is why this is
 * affordable at export scale where a per-node blur would not be.
 *
 * And every radius here is expressed through `ctx.u()`, which maps design
 * units to pixels from the actual render size. A 4x export therefore re-derives
 * its blur and bloom radii rather than scaling up the preview's, which is the
 * difference between an export that matches the preview and one that looks
 * like the preview enlarged.
 */

/**
 * Three tiers, not a continuous gradient.
 *
 * Discrete tiers rasterise predictably: each is one buffer blurred once by a
 * known radius, so the export is the preview at a different resolution rather
 * than a different image. A continuous per-node blur would be both slower and
 * unpredictable at scale.
 */
const TIERS = 3
const tierOf = (plane: number): number => (plane < 0.34 ? 0 : plane < 0.72 ? 1 : 2)
const tierCentre = [0.17, 0.53, 0.86]

export type PipelineInput = {
  ctx: RenderContext
  graph: SceneGraph
  plan: LayoutPlan
  character: Character
  /** 0.25 draft .. 4 export; gates the expensive passes */
  quality: number
}

type Ctx2D = CanvasRenderingContext2D

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/**
 * Hand quality: seeded imperfection, applied to geometry on its way to the
 * raster.
 *
 * Machine-perfect geometry is the tell. Every repeated element gets its own
 * small independent displacement, and curves pick up a low-frequency wobble
 * rather than staying mathematically exact. It is driven from `seedRef`, so a
 * node jitters the same way on every re-render and determinism holds.
 */
function jitter(p: Path, seedRef: number, amount: number, seed: string): Path {
  if (amount <= 0) return p
  const rng = makeRng(seed, `hand:${seedRef}`)
  const pts = new Float64Array(p.pts)
  // one low-frequency phase per node, so the wobble runs along the form
  // instead of shivering point to point
  const phase = rng.range(0, Math.PI * 2)
  const freq = rng.range(0.6, 1.8)
  const bias = { x: rng.gauss() * amount * 0.6, y: rng.gauss() * amount * 0.6 }
  for (let i = 0; i < pts.length; i += 2) {
    const t = i / Math.max(2, pts.length)
    const wob = Math.sin(phase + t * freq * Math.PI * 2)
    pts[i] = (pts[i] as number) + bias.x + wob * amount * 0.5
    pts[i + 1] = (pts[i + 1] as number) + bias.y + Math.cos(phase + t * freq * 5.1) * amount * 0.5
  }
  return { ops: p.ops, pts }
}

function geomToPath2D(g: Geom, ctx: RenderContext, n: Node, hand: number): Path2D {
  switch (g.k) {
    case 'sdf':
      return g.path ? toPath2D(jitter(g.path, n.seedRef, hand, ctx.seed)) : new Path2D()
    case 'path':
      return toPath2D(jitter(g.path, n.seedRef, hand, ctx.seed))
    case 'ellipse': {
      const p = new Path2D()
      p.ellipse(g.cx, g.cy, Math.abs(g.rx), Math.abs(g.ry), g.rot, 0, Math.PI * 2)
      return p
    }
    case 'poly': {
      const p = new Path2D()
      if (g.pts.length >= 4) {
        p.moveTo(g.pts[0] as number, g.pts[1] as number)
        for (let i = 2; i < g.pts.length; i += 2) p.lineTo(g.pts[i] as number, g.pts[i + 1] as number)
        if (g.closed) p.closePath()
      }
      return p
    }
    default: {
      const p = new Path2D()
      for (let i = 0, k = 0; i < g.pts.length; i += 2, k++) {
        const r = g.r[k] as number
        p.moveTo((g.pts[i] as number) + r, g.pts[i + 1] as number)
        p.arc(g.pts[i] as number, g.pts[i + 1] as number, r, 0, Math.PI * 2)
      }
      return p
    }
  }
}

function geomBounds(g: Geom): { x0: number; y0: number; x1: number; y1: number } {
  switch (g.k) {
    case 'sdf': return g.path ? bounds(g.path) : { x0: 0, y0: 0, x1: 0, y1: 0 }
    case 'path': return bounds(g.path)
    case 'ellipse': return { x0: g.cx - g.rx, y0: g.cy - g.ry, x1: g.cx + g.rx, y1: g.cy + g.ry }
    default: {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let i = 0; i < g.pts.length; i += 2) {
        const x = g.pts[i] as number, y = g.pts[i + 1] as number
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
      return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 }
    }
  }
}

/**
 * Atmospheric falloff, from plane alone.
 *
 * A far node is lower in contrast and closer to the ground colour. This is one
 * line and it is most of what makes depth read; no renderer has to think about
 * it, and both backends apply the same rule so they agree.
 */
function hazedTone(tone: number, plane: number): number {
  return Math.max(0, Math.min(1, tone * (0.5 + 0.5 * plane)))
}

/** Fill style for a node, from its material. */
function applyMaterial(c: Ctx2D, ctx: RenderContext, n: Node, p2: Path2D, hand: number): void {
  const tone = hazedTone(n.tone, n.plane)
  const b = geomBounds(n.geom)
  const alpha = (n.alpha ?? 1) * (0.68 + 0.32 * n.plane)
  const m = n.material
  c.globalAlpha = alpha

  switch (m.k) {
    case 'mass': {
      // A solid, lit from the composition's one source. The gradient runs
      // along the light direction so every mass in the frame agrees.
      const dx = -ctx.light.dx
      const dy = ctx.light.dy
      const cx = (b.x0 + b.x1) / 2
      const cy = (b.y0 + b.y1) / 2
      const r = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.6 || 1
      const g = c.createLinearGradient(cx - dx * r, cy - dy * r, cx + dx * r, cy + dy * r)
      g.addColorStop(0, ctx.ramp(Math.min(1, tone * 1.3 + 0.12)))
      g.addColorStop(1, mixHex(ctx.ramp(tone * 0.55), ctx.palette.ink, 0.32))
      c.fillStyle = g
      c.fill(p2)
      // an edge, so overlapping masses read as one in front of another rather
      // than as washes of translucent colour
      c.strokeStyle = withAlpha(tone > 0.55 ? ctx.palette.ink : ctx.ramp(1), 0.3 * m.facing)
      c.lineWidth = ctx.u(1.6)
      c.stroke(p2)
      break
    }

    case 'film': {
      const cx = b.x0 + (b.x1 - b.x0) * 0.46
      const cy = b.y0 + (b.y1 - b.y0) * 0.42
      const r = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.58 || 1
      const g = c.createRadialGradient(cx, cy, r * 0.05, cx, cy, r)
      const bright = ctx.palette.ramp[ctx.palette.ramp.length - 1] as string
      g.addColorStop(0, withAlpha(ctx.ramp(tone), 0.16))
      g.addColorStop(0.62, withAlpha(ctx.ramp(tone), 0.3))
      g.addColorStop(0.9, withAlpha(ctx.ramp(Math.min(1, tone + 0.2)), 0.62 * m.iridescence + 0.2))
      g.addColorStop(1, withAlpha(bright, 0.3))
      c.fillStyle = g
      c.fill(p2)
      c.strokeStyle = withAlpha(ctx.ramp(Math.min(1, tone + 0.3)), 0.35 + 0.4 * m.rim)
      c.lineWidth = ctx.u(n.weight ?? 1.6)
      c.stroke(p2)
      break
    }

    case 'screen': {
      // Three plates, each offset independently. One shared offset is what
      // reads as a cheap drop shadow rather than as misregistered print.
      const s = ctx.u(m.spread * 3)
      const prev = c.globalCompositeOperation
      c.globalCompositeOperation = 'multiply'
      c.globalAlpha = alpha * 0.55
      const plate = (dx: number, dy: number, hex: string) => {
        c.save()
        c.translate(dx, dy)
        c.fillStyle = hex
        c.fill(p2)
        c.restore()
      }
      plate(-s, s * 0.4, mixHex(ctx.ramp(tone), '#00A0C6', 0.45))
      plate(s * 0.7, -s * 0.3, mixHex(ctx.ramp(tone), '#D6006E', 0.45))
      plate(s * 0.2, s * 0.8, mixHex(ctx.ramp(tone), '#E8C400', 0.4))
      c.globalCompositeOperation = prev
      break
    }

    case 'riso': {
      const prev = c.globalCompositeOperation
      c.globalCompositeOperation = 'multiply'
      c.globalAlpha = alpha * (0.72 + 0.2 * (1 - m.mottle))
      c.fillStyle = ctx.ramp(tone)
      c.fill(p2)
      c.globalCompositeOperation = prev
      break
    }

    case 'ink': {
      /**
       * Weight modulates along the path as if pressure varied.
       *
       * Canvas has no variable-width stroke, so the path is flattened and
       * drawn as short segments with their own widths. A constant-width stroke
       * is the single most machine-looking mark a renderer can make, and this
       * is the pass that fixes it for every family at once.
       */
      const base = ctx.u(n.weight ?? 1.5) * (0.8 + 0.5 * m.pressure)
      // Ink is drawn ON a surface, so it does not recede with the surface: a
      // line hazed as hard as the mass it sits on vanishes into it, and the
      // masses lose the texture that tells you what they are made of.
      c.strokeStyle = ctx.ramp(Math.max(0, Math.min(1, n.tone * (0.78 + 0.22 * n.plane))))
      c.lineCap = 'round'
      c.lineJoin = 'round'
      const inkPath = n.geom.k === 'path' ? n.geom.path : n.geom.k === 'sdf' ? n.geom.path : undefined
      const runs = inkPath
        ? flatten(jitter(inkPath, n.seedRef, hand, ctx.seed), 10)
        : n.geom.k === 'poly'
          ? [Array.from(n.geom.pts)]
          : []
      if (runs.length === 0) {
        c.lineWidth = base
        c.stroke(p2)
        break
      }
      const rng = makeRng(ctx.seed, `ink:${n.seedRef}`)
      const phase = rng.range(0, Math.PI * 2)
      for (const run of runs) {
        for (let i = 0; i + 3 < run.length; i += 2) {
          const t = i / Math.max(2, run.length - 2)
          const press = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(phase + t * Math.PI * 2 * 1.7))
          c.lineWidth = base * press
          c.globalAlpha = alpha * (1 - 0.25 * m.bleed) * (0.82 + 0.18 * press)
          c.beginPath()
          c.moveTo(run[i] as number, run[i + 1] as number)
          c.lineTo(run[i + 2] as number, run[i + 3] as number)
          c.stroke()
        }
        // Line ends overshoot their corner, the way a drawn line does.
        if (run.length >= 4) {
          const n1 = run.length
          const ex = (run[n1 - 2] as number) - (run[n1 - 4] as number)
          const ey = (run[n1 - 1] as number) - (run[n1 - 3] as number)
          const l = Math.hypot(ex, ey) || 1
          const over = ctx.u(1.6) * (0.5 + m.pressure)
          c.lineWidth = base * 0.7
          c.beginPath()
          c.moveTo(run[n1 - 2] as number, run[n1 - 1] as number)
          c.lineTo((run[n1 - 2] as number) + (ex / l) * over, (run[n1 - 1] as number) + (ey / l) * over)
          c.stroke()
        }
      }
      break
    }

    case 'emissive': {
      /**
       * The composition's one bright accent, and the only thing in the frame
       * allowed to leave the ramp.
       *
       * The ramp is the structural range — every mass, line and texture is
       * somewhere on it — so a light source drawn from the top of it is just
       * the palest structure rather than a light. It has to be the palette's
       * accent, which is the colour that exists for exactly this.
       *
       * The body stays well short of full: the bloom pass is what makes it
       * read as bright, and a body already at the top of the range plus a
       * bloom on top of it is a blown highlight with no shape left in it.
       */
      const hot = mixHex(ctx.palette.accent, ctx.ramp(1), 0.35 * m.intensity)
      if (n.stroke) {
        c.strokeStyle = hot
        c.lineWidth = ctx.u(n.weight ?? 2)
        c.stroke(p2)
      } else {
        const cx = (b.x0 + b.x1) / 2
        const cy = (b.y0 + b.y1) / 2
        const r = Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.7 || 1
        const g = c.createRadialGradient(cx, cy - r * 0.2, r * 0.05, cx, cy, r)
        g.addColorStop(0, hot)
        g.addColorStop(1, mixHex(hot, ctx.palette.ground, 0.45))
        c.fillStyle = g
        c.fill(p2)
        // a hot rim where the opening meets the mass around it
        c.strokeStyle = ctx.palette.accent
        c.lineWidth = ctx.u(2.2)
        c.stroke(p2)
      }
      break
    }

    default:
      if (n.stroke) {
        c.strokeStyle = ctx.ramp(tone)
        c.lineWidth = ctx.u(n.weight ?? 1.5)
        c.lineCap = 'round'
        c.stroke(p2)
      } else {
        c.fillStyle = ctx.ramp(tone)
        c.fill(p2)
        if (m.edgeDark > 0.01) {
          c.strokeStyle = withAlpha(ctx.palette.ink, 0.35 * m.edgeDark)
          c.lineWidth = ctx.u(1.4)
          c.stroke(p2)
        }
      }
  }
  c.globalAlpha = 1
}

/** The focal form's own path, as a canvas path. */
function formPath(ctx: RenderContext): Path2D {
  const p = new Path2D()
  for (const foc of ctx.focals) p.addPath(new Path2D(foc.path))
  return p
}

export function renderGraph(input: PipelineInput): (c: Ctx2D) => void {
  const { ctx, graph, plan, character, quality } = input

  return (out: Ctx2D) => {
    const w = ctx.w
    const h = ctx.h
    const draft = quality < 0.5

    // --- pass 0: sort by plane ---------------------------------------------
    const nodes = [...graph.nodes].sort((a, b) => a.plane - b.plane)

    // Focus sits on the emissive node if there is one, which is the subject by
    // construction, and on the middle tier otherwise.
    const emissive = nodes.filter((n) => n.light.emissive > 0)
    const focus = emissive.length
      ? (emissive.reduce((s, n) => s + n.plane, 0) / emissive.length)
      : 0.55

    const hand = draft ? 0 : ctx.u(1.15)

    // --- tier buffers -------------------------------------------------------
    const tiers = Array.from({ length: TIERS }, () => makeCanvas(w, h))
    const shadows = Array.from({ length: TIERS }, () => makeCanvas(w, h))
    const tierCtx = tiers.map((t) => t.getContext('2d') as Ctx2D)
    const shadowCtx = shadows.map((t) => t.getContext('2d') as Ctx2D)

    const form = formPath(ctx)
    const inverse = new Path2D()
    inverse.rect(0, 0, w, h)
    inverse.addPath(form)

    const setTransform = (c: Ctx2D) => {
      c.setTransform(1, 0, 0, 1, 0, 0)
      if (plan.flip || Math.abs(plan.rotate) > 0.01 || Math.abs(plan.zoom - 1) > 0.001) {
        c.translate(w / 2, h / 2)
        c.rotate((plan.rotate * Math.PI) / 180)
        c.scale(plan.flip ? -plan.zoom : plan.zoom, plan.zoom)
        c.translate(-w / 2, -h / 2)
      }
    }
    for (const c of [...tierCtx, ...shadowCtx]) setTransform(c)

    // --- pass 1-2: contact darkening and cast shadows ----------------------
    /**
     * Shadows go into their own buffer per tier so the whole tier can be
     * blurred once. Softness is set by how far the caster is from what it
     * lands on — a near mass casts a crisp edge and a far one a diffuse smear
     * — which is the cue that makes a depth order legible rather than merely
     * present.
     */
    for (const n of nodes) {
      if (!n.light.casts || n.material.k === 'ink') continue
      const t = tierOf(n.plane)
      const c = shadowCtx[t] as Ctx2D
      const p2 = geomToPath2D(n.geom, ctx, n, hand)
      const b = geomBounds(n.geom)
      if (Math.max(b.x1 - b.x0, b.y1 - b.y0) < ctx.u(24)) continue

      // contact: short, tight, immediately under the form
      c.save()
      c.globalAlpha = 0.38
      c.fillStyle = ctx.palette.ink
      c.translate(-ctx.light.dx * ctx.u(3), ctx.u(3.5))
      c.fill(p2)
      c.restore()

      // cast: long, offset down the light, weaker
      c.save()
      c.globalAlpha = 0.3
      c.fillStyle = ctx.palette.ink
      c.translate(-ctx.light.dx * ctx.u(10 + 40 * n.plane), ctx.u(8 + 26 * n.plane))
      c.fill(p2)
      c.restore()
    }

    // --- pass 3: material resolution ---------------------------------------
    for (const n of nodes) {
      const t = tierOf(n.plane)
      const c = tierCtx[t] as Ctx2D
      const p2 = geomToPath2D(n.geom, ctx, n, hand)
      c.save()
      if (n.mask === 'inside') c.clip(form)
      else if (n.mask === 'outside') c.clip(inverse, 'evenodd')
      applyMaterial(c, ctx, n, p2, hand)
      c.restore()
    }

    // --- the ground, atmosphere and the focal form -------------------------
    out.setTransform(1, 0, 0, 1, 0, 0)
    out.fillStyle = ctx.palette.ground
    out.fillRect(0, 0, w, h)

    // Large blurred colour fields: a mesh gradient built out of shapes, which
    // costs a handful of small regions rather than a full-frame pass.
    const atmo = makeCanvas(w, h)
    const ac = atmo.getContext('2d') as Ctx2D
    const arng = makeRng(ctx.seed, 'atmo')
    ac.filter = `blur(${ctx.u(70 * character.atmosphere)}px)`
    for (let i = 0; i < 5; i++) {
      const cx = arng.range(-0.1, 1.1) * w
      const cy = arng.range(-0.1, 1.1) * h
      const r = ctx.short * arng.range(0.32, 0.78)
      ac.globalAlpha = 0.62
      ac.fillStyle = ctx.ramp(arng.range(0.25, 0.8))
      ac.beginPath()
      ac.ellipse(cx, cy, r, r * arng.range(0.6, 1.3), arng.range(0, Math.PI), 0, Math.PI * 2)
      ac.fill()
    }
    out.save()
    out.globalCompositeOperation = ctx.palette.mode === 'light' ? 'multiply' : 'screen'
    out.globalAlpha = 0.68
    out.drawImage(atmo, 0, 0)
    out.restore()

    setTransform(out)
    out.save()
    out.globalAlpha = 0.9
    out.fillStyle = mixHex(ctx.palette.ground, ctx.palette.ramp[0] as string, character.formFill)
    out.fill(form)
    out.restore()
    out.setTransform(1, 0, 0, 1, 0, 0)

    // --- pass 4: depth of field, compositing far to near --------------------
    /**
     * Radii come through ctx.u(), so they are derived from the render size
     * rather than scaled from the preview. This is the difference between an
     * export that matches what was on screen and one that looks like the
     * preview blown up.
     */
    // Enough separation to read as depth, not enough to throw the frame
    // away. Two of the three tiers are off-focus in most compositions, so a
    // radius tuned to look right on the far one alone blurs most of the
    // picture.
    const maxBlur = ctx.u(draft ? 0 : 11)
    for (let t = 0; t < TIERS; t++) {
      const dist = Math.abs((tierCentre[t] as number) - focus)
      const blur = maxBlur * Math.min(1, dist * 1.5)

      out.save()
      out.filter = blur > 0.4 ? `blur(${blur.toFixed(2)}px)` : 'none'
      out.globalAlpha = 0.62
      out.drawImage(shadows[t] as HTMLCanvasElement, 0, 0)
      out.globalAlpha = 1
      out.drawImage(tiers[t] as HTMLCanvasElement, 0, 0)
      out.restore()
    }

    // --- pass 5: bloom and halation -----------------------------------------
    if (!draft && emissive.length) {
      const glow = makeCanvas(w, h)
      const gc = glow.getContext('2d') as Ctx2D
      setTransform(gc)
      for (const n of emissive) {
        const p2 = geomToPath2D(n.geom, ctx, n, hand)
        gc.fillStyle = ctx.palette.accent
        gc.globalAlpha = n.light.emissive
        if (n.stroke) {
          gc.strokeStyle = gc.fillStyle
          gc.lineWidth = ctx.u((n.weight ?? 3) * 2)
          gc.stroke(p2)
        } else {
          gc.fill(p2)
        }
      }

      out.save()
      out.globalCompositeOperation = 'lighter'
      out.filter = `blur(${ctx.u(14 * character.bloom).toFixed(2)}px)`
      out.globalAlpha = 0.2
      out.drawImage(glow, 0, 0)
      // Halation: a wider, warmer ring outside the same source. Film responds
      // to a hot highlight by scattering it in the red layer, so the halo is
      // warm even when the light that made it was not.
      out.filter = `blur(${ctx.u(46 * character.bloom).toFixed(2)}px)`
      out.globalAlpha = 0.12
      out.drawImage(glow, 0, 0)
      out.restore()

      out.save()
      out.globalCompositeOperation = 'lighter'
      out.filter = `blur(${ctx.u(60 * character.bloom).toFixed(2)}px)`
      out.globalAlpha = 0.07
      out.fillStyle = '#FF7A3C'
      out.globalCompositeOperation = 'lighter'
      out.drawImage(glow, 0, 0)
      out.restore()
    }

    // --- pass 6-7: grade and film -------------------------------------------
    // Skipped on the draft: they are the two full-buffer passes and the draft
    // exists precisely to avoid paying for them during a slider drag.
    if (!draft) {
      const img = out.getImageData(0, 0, w, h)
      applyLut(img.data, lutFor({
        split: 0.75,
        toe: 0.8,
        warmth: graph.warmth ?? 0,
        lift: ctx.palette.mode === 'dark' ? 0.5 : 0,
      }))
      applyFilm(img.data, {
        seed: ctx.seed,
        width: w,
        height: h,
        grain: 0.3 * character.grain,
        vignette: character.vignette,
        cx: plan.screen.cx,
        cy: plan.screen.cy,
        dust: 0.4,
      })
      out.putImageData(img, 0, 0)
      drawDust(out, { seed: ctx.seed, width: w, height: h, amount: 0.4, unit: ctx.u(2.4) })
    }
  }
}

/** Whether the raster pipeline can run at all. */
export function canRaster(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function'
}

/** Element count, for the budget assertion. */
export function countPrimitives(graph: SceneGraph): number {
  let n = 0
  for (const node of graph.nodes) {
    const pathOf = node.geom.k === 'path' ? node.geom.path : node.geom.k === 'sdf' ? node.geom.path : undefined
    if (node.geom.k === 'points') n += node.geom.r.length
    else if (pathOf) {
      let cmds = 0
      walk(pathOf, (op) => { if (op !== OP.close) cmds++ })
      n += Math.max(1, Math.ceil(cmds / 4))
    } else n += 1
  }
  return n
}
