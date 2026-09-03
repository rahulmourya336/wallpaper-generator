import { el, f as fmt } from '../svg'
import { mixHex, withAlpha } from '../palette'
import type { RenderContext, Scene } from '../types'
import { bounds, toD, translate } from './path'
import type { Path } from './path'
import type { Geom, Material, Node, SceneGraph } from './types'

/**
 * The vector backend.
 *
 * The post pipeline is a raster process — ordered dithering, chroma-aware
 * grain, per-channel plate offsets and a perceptual grade are none of them
 * expressible as SVG filters. So SVG output becomes an approximation: the
 * geometry is exact and the materials are stood in for with gradients and
 * offsets, but the film pass does not happen. That is the agreed trade for
 * keeping a real vector download.
 *
 * It is also what carries the migration. A family that has been ported to the
 * scene graph renders through here and comes out looking like it did before,
 * which means the graph can be proved to carry enough information one family
 * at a time without the pipeline existing yet.
 *
 * Everything here reads `tone` and `plane` and resolves colour from the
 * palette. No renderer does that any more.
 */

/** Tone buckets for the shared gradients. One per node would be hundreds. */
const TIERS = 6

const tierOf = (tone: number): number =>
  Math.max(0, Math.min(TIERS - 1, Math.round(tone * (TIERS - 1))))

/**
 * Atmospheric falloff from plane alone.
 *
 * This is the whole point of the field: a far node is lower in contrast and
 * pushed toward the ground, a near node is not, and no renderer has to think
 * about it. Applied here so the vector backend and the raster pipeline agree
 * on what depth looks like.
 */
function haze(ctx: RenderContext, tone: number, plane: number): number {
  return tone * (0.52 + 0.48 * plane) + (1 - plane) * 0.06 * (ctx.palette.mode === 'light' ? 1 : -1)
}

function planeAlpha(plane: number): number {
  return 0.62 + 0.38 * plane
}

export function geomToD(geom: Geom): string {
  switch (geom.k) {
    case 'path':
      return toD(geom.path)
    case 'ellipse': {
      const { cx, cy, rx, ry } = geom
      return (
        `M${fmt(cx - rx)} ${fmt(cy)}` +
        `A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx + rx)} ${fmt(cy)}` +
        `A${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(cx - rx)} ${fmt(cy)}Z`
      )
    }
    case 'poly': {
      const p = geom.pts
      if (p.length < 4) return ''
      let d = `M${fmt(p[0] as number)} ${fmt(p[1] as number)}`
      for (let i = 2; i < p.length; i += 2) d += `L${fmt(p[i] as number)} ${fmt(p[i + 1] as number)}`
      return geom.closed ? `${d}Z` : d
    }
    default: {
      let d = ''
      for (let i = 0, k = 0; i < geom.pts.length; i += 2, k++) {
        const x = geom.pts[i] as number
        const y = geom.pts[i + 1] as number
        const r = geom.r[k] as number
        d += `M${fmt(x - r)} ${fmt(y)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(x + r)} ${fmt(y)}A${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(x - r)} ${fmt(y)}Z`
      }
      return d
    }
  }
}

function nodePath(geom: Geom): Path | null {
  return geom.k === 'path' ? geom.path : null
}

/** Shared gradients, one small set per composition rather than per node. */
function materialDefs(ctx: RenderContext, uid: string): string[] {
  const { palette: p, light } = ctx
  const out: string[] = []

  // A mass is lit from one side. The gradient runs along the light direction
  // so every solid in the frame agrees with every other one.
  const gx = -light.dx
  const gy = light.dy
  for (let t = 0; t < TIERS; t++) {
    const tone = t / (TIERS - 1)
    out.push(el('linearGradient',
      {
        id: `${uid}-m${t}`, gradientUnits: 'objectBoundingBox',
        x1: fmt(50 - gx * 50) + '%', y1: fmt(50 - gy * 50) + '%',
        x2: fmt(50 + gx * 50) + '%', y2: fmt(50 + gy * 50) + '%',
      },
      el('stop', { offset: '0%', 'stop-color': ctx.ramp(Math.min(1, tone * 1.25 + 0.1)) }) +
      el('stop', { offset: '100%', 'stop-color': mixHex(ctx.ramp(tone * 0.6), p.ink, 0.3) })))
  }

  // A film is transparent through the middle and piles colour up at the rim,
  // where the line of sight runs along the surface.
  const bright = p.ramp[p.ramp.length - 1] as string
  for (let t = 0; t < TIERS; t++) {
    const tone = t / (TIERS - 1)
    out.push(el('radialGradient',
      { id: `${uid}-fl${t}`, gradientUnits: 'objectBoundingBox', cx: '46%', cy: '42%', r: '58%' },
      el('stop', { offset: '0%', 'stop-color': withAlpha(ctx.ramp(tone), 0.16) }) +
      el('stop', { offset: '62%', 'stop-color': withAlpha(ctx.ramp(tone), 0.3) }) +
      el('stop', { offset: '90%', 'stop-color': withAlpha(ctx.ramp(Math.min(1, tone + 0.2)), 0.62) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(bright, 0.3) })))
  }

  return out
}

/**
 * One node to SVG source.
 *
 * Material is the only thing that decides how a node is painted, and `tone`
 * plus `plane` are the only things that decide its value. That is the contract
 * the raster pipeline will honour too, which is what lets the two backends
 * produce the same picture.
 */
function paint(ctx: RenderContext, uid: string, n: Node): string {
  const d = geomToD(n.geom)
  if (!d) return ''
  const tone = Math.max(0, Math.min(1, haze(ctx, n.tone, n.plane)))
  const tier = tierOf(tone)
  const alpha = (n.alpha ?? 1) * planeAlpha(n.plane)
  const m: Material = n.material
  const w = n.weight !== undefined ? ctx.u(n.weight) : ctx.u(1.5)

  switch (m.k) {
    case 'ink': {
      // Weight modulation along the path is a raster affair; the vector
      // backend gets a single stroke and the pressure only sets its width.
      return el('path', {
        d, fill: 'none',
        stroke: ctx.ramp(tone),
        'stroke-width': w * (0.8 + 0.5 * m.pressure),
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        opacity: alpha * (1 - 0.25 * m.bleed),
      })
    }

    case 'screen': {
      // Three plates, each with its own offset. A single duplicated offset is
      // the thing that reads as a cheap drop shadow rather than as print.
      const p = nodePath(n.geom)
      const s = ctx.u(m.spread * 3)
      const plate = (dx: number, dy: number, hex: string) =>
        el('path', {
          d: p ? toD(translate(p, dx, dy)) : d,
          fill: hex,
          opacity: alpha * 0.55,
          style: 'mix-blend-mode:multiply',
          ...(p ? {} : { transform: `translate(${fmt(dx)} ${fmt(dy)})` }),
        })
      return (
        plate(-s, s * 0.4, mixHex(ctx.ramp(tone), '#00A0C6', 0.45)) +
        plate(s * 0.7, -s * 0.3, mixHex(ctx.ramp(tone), '#D6006E', 0.45)) +
        plate(s * 0.2, s * 0.8, mixHex(ctx.ramp(tone), '#E8C400', 0.4)) +
        el('path', { d, fill: ctx.ramp(tone), opacity: alpha * 0.5 })
      )
    }

    case 'riso':
      return el('path', {
        d, fill: ctx.ramp(tone),
        opacity: alpha * (0.72 + 0.2 * (1 - m.mottle)),
        style: 'mix-blend-mode:multiply',
      })

    case 'emissive':
      return el('path', {
        d,
        fill: n.stroke ? 'none' : ctx.ramp(Math.min(1, tone + 0.25 * m.intensity)),
        ...(n.stroke ? { stroke: ctx.ramp(Math.min(1, tone + 0.25 * m.intensity)), 'stroke-width': w } : {}),
        opacity: alpha,
      })

    case 'film':
      return (
        el('path', { d, fill: `url(#${uid}-fl${tier})`, opacity: alpha }) +
        el('path', {
          d, fill: 'none',
          stroke: withAlpha(ctx.ramp(Math.min(1, tone + 0.3)), 0.35 + 0.4 * m.rim),
          'stroke-width': w,
          opacity: alpha,
        })
      )

    case 'mass':
      return (
        el('path', { d, fill: `url(#${uid}-m${tier})`, opacity: alpha }) +
        // an edge, so overlapping masses read as one in front of another
        el('path', {
          d, fill: 'none',
          stroke: withAlpha(tone > 0.55 ? ctx.palette.ink : ctx.ramp(1), 0.3 * m.facing),
          'stroke-width': ctx.u(1.6),
          opacity: alpha,
        })
      )

    default: {
      const edge = m.edgeDark
      return (
        el('path', {
          d,
          ...(n.stroke
            ? { fill: 'none', stroke: ctx.ramp(tone), 'stroke-width': w, 'stroke-linecap': 'round' }
            : { fill: ctx.ramp(tone) }),
          opacity: alpha,
        }) +
        (edge > 0.01 && !n.stroke
          ? el('path', {
            d, fill: 'none',
            stroke: withAlpha(ctx.palette.ink, 0.35 * edge),
            'stroke-width': ctx.u(1.4),
            opacity: alpha,
          })
          : '')
      )
    }
  }
}

/**
 * A contact shadow, derived from the node rather than authored by it.
 *
 * Where a form meets what is behind it, a short dark falloff is the cue the
 * eye reads as "solid object standing on something" — and its absence is most
 * of why flat compositions look like stickers. In the vector backend it is one
 * offset copy at a low alpha; the raster pipeline will do the real thing.
 */
function contact(ctx: RenderContext, n: Node): string {
  if (!n.light.casts) return ''
  const p = nodePath(n.geom)
  if (!p) return ''
  const b = bounds(p)
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0)
  if (size < ctx.u(30)) return ''
  // Softness scales with how far the caster is from what it lands on, which is
  // the only reason a near block and a far one look different.
  const drop = ctx.u(6 + 34 * n.plane)
  return el('path', {
    d: toD(translate(p, -ctx.light.dx * drop, drop * 0.6)),
    fill: withAlpha(ctx.palette.ink, 0.16 + 0.26 * n.plane),
  })
}

/**
 * Resolve a scene graph into the four layers the current compositor consumes.
 *
 * The mapping is the interesting part of the migration. `mask` decides which
 * clip a node lands in, and `plane` decides the order within it — the two
 * things the old four-layer model had welded together, which is why five
 * renderers were pushing the same content into two layers to get a form that
 * both reads at the edge and continues past it. Here a node says `mask:'none'`
 * once and appears in both, with the far copy hazed by its own plane.
 */
export function resolveToScene(ctx: RenderContext, graph: SceneGraph): Scene {
  const uid = ctx.uid
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const sorted = [...graph.nodes].sort((a, b) => a.plane - b.plane)

  let accent: string | undefined
  let bestEmissive = 0

  for (const n of sorted) {
    const body = paint(ctx, uid, n)
    if (!body) continue
    const shade = contact(ctx, n)
    const piece = shade + body

    switch (n.mask) {
      case 'outside':
        back.push(piece)
        break
      case 'inside':
        subject.push(piece)
        break
      default:
        // Unclipped nodes appear on both sides of the form: at full strength
        // inside it, hazed outside. One declaration, two appearances.
        subject.push(piece)
        behind.push(el('g', { opacity: (0.4 + 0.25 * n.plane).toFixed(3) }, piece))
        if (n.plane > 0.86) front.push(body)
    }

    if (n.light.emissive > bestEmissive) {
      bestEmissive = n.light.emissive
      const d = geomToD(n.geom)
      accent =
        el('path', {
          d, fill: 'none', stroke: ctx.palette.accent,
          'stroke-width': ctx.u((n.weight ?? 2.5) * 1.6), 'stroke-linecap': 'round',
        }) +
        el('path', {
          d, fill: 'none', stroke: withAlpha(ctx.palette.accent, 0.35),
          'stroke-width': ctx.u((n.weight ?? 2.5) * 4), 'stroke-linecap': 'round',
        })
    }
  }

  const scene: Scene = {
    back, behind, subject, front,
    defs: materialDefs(ctx, uid),
  }
  if (accent) scene.accent = accent
  return scene
}
