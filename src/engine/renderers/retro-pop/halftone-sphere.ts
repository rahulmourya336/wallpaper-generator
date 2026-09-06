import { hexToRgb } from '../../palette'
import { clamp, el, f, group, lerp, poly } from '../../svg'
import type { Focal, ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A sphere printed as a halftone screen.
 *
 * The dot is the only mark in the picture and everything is said with its size:
 * the modelling of the form, the shadow it drops, the rim that keeps its dark
 * limb from dissolving into the ground. What makes that read as print rather
 * than as a rendered ball is that there is more than one screen — an even tint
 * on the paper, a coarse one on the form, a fine one wherever the coarse screen
 * runs out, and a third plate in the accent — each at its own pitch and its own
 * angle, the way separate plates are screened so their rosettes do not collide.
 *
 * The previous version had one pitch for everything, gave the field random
 * per-dot radii (which is snow, not a screen), and let the lit dots grow past
 * touching into a flat lobe with a scalloped edge. Every radius here comes from
 * a shading term and none of them is allowed to reach its neighbour.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Dot density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'bands', label: 'Screen steps', type: 'range', min: 3, max: 16, step: 1, default: 10 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.66 },
  { key: 'field', label: 'Surrounding field', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'skew', label: 'Screen angle', type: 'range', min: 0, max: 1, step: 0.01, default: 0.34 },
  { key: 'ring', label: 'Ring', type: 'range', min: 0, max: 1, step: 0.01, default: 0.72 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'disc', 'ellipse'], default: 'auto' },
]

type Box = { x0: number; y0: number; x1: number; y1: number }

/**
 * Walk a square lattice turned to a screen angle.
 *
 * Halftone lattices are rotated, not sheared: shearing rows is what turned the
 * old grid into a slanted table and then slid it off the side of the canvas.
 * Corners of the region are mapped back into lattice space to get the index
 * range, so the walk covers the box exactly however the screen is turned.
 * `phase` is the position within the cell — half a cell is the tile centre,
 * which is where the `<pattern>` behind the paper tint puts its dot, and a
 * whole cell lands in the interstices of a screen already drawn at half.
 */
function walkScreen(
  ctx: RenderContext,
  pitch: number,
  angle: number,
  box: Box,
  visit: (x: number, y: number) => void,
  phase = 0.5,
): void {
  const cs = Math.cos(angle)
  const sn = Math.sin(angle)
  let i0 = Infinity
  let i1 = -Infinity
  let j0 = Infinity
  let j1 = -Infinity
  const corners = [
    [box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1],
  ] as const
  for (const [x, y] of corners) {
    const li = (x * cs + y * sn) / pitch
    const lj = (-x * sn + y * cs) / pitch
    if (li < i0) i0 = li
    if (li > i1) i1 = li
    if (lj < j0) j0 = lj
    if (lj > j1) j1 = lj
  }
  const ia = Math.floor(i0) - 1
  const ib = Math.ceil(i1) + 1
  const ja = Math.floor(j0) - 1
  const jb = Math.ceil(j1) + 1
  for (let j = ja; j <= jb; j++) {
    if ((j & 3) === 0 && ctx.expired()) return
    for (let i = ia; i <= ib; i++) {
      const lx = (i + phase) * pitch
      const ly = (j + phase) * pitch
      visit(lx * cs - ly * sn, lx * sn + ly * cs)
    }
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function bboxOf(fo: Focal, pad: number): Box {
  return {
    x0: fo.cx - fo.rx * pad, y0: fo.cy - fo.ry * pad,
    x1: fo.cx + fo.rx * pad, y1: fo.cy + fo.ry * pad,
  }
}

function luma(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focals, palette, light } = ctx
  const densityK = ctx.num('density')
  const steps = Math.max(3, Math.round(ctx.num('bands')))
  const fieldK = ctx.num('field')
  const ringK = ctx.num('ring')
  const skew = ctx.num('skew')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []
  const defs: string[] = []
  const accentDots: string[] = []

  /**
   * Which way the ink runs.
   *
   * `ramp(t)` is ordered by contrast against the ground, not by lightness, so on
   * half the pool the top of the ramp is a bright colour on a dark ground and on
   * the other half it is near-black on a bright one. A screen has to know:
   * where the ink is lighter than the paper, dots grow toward the light and the
   * shadow is bare paper, and where it is darker they grow toward the shadow.
   * Getting this backwards is what made the old version's lit pole read as the
   * darkest part of the form on every warm palette.
   */
  const inkIsLight = luma(palette.ramp[4]) > luma(palette.ground)

  /**
   * The light as a three-vector.
   *
   * Shading a ball off the screen-space light alone puts the highlight on the
   * silhouette and makes the terminator a straight chord, which is why the old
   * version's bands were three parallel staircases. Lifting the light toward
   * the viewer puts the hot spot inside the disc and bends every iso-lit
   * contour into an ellipse, which is what roundness actually looks like.
   */
  const lz = 0.5
  const ln = Math.hypot(light.dx, light.dy, lz)
  const Lx = light.dx / ln
  const Ly = light.dy / ln
  const Lz = lz / ln

  /**
   * The dot count across a form, not the dot size, is what a poster fixes.
   *
   * Pitch measured in absolute units gave a frame-filling sphere a hundred dots
   * across and a small twin a dozen. Deriving it from the radius keeps the
   * screen reading at the same coarseness whatever the layout does with scale —
   * and it hands the smaller companion a finer pitch for free, so a twin is two
   * screened spheres rather than one screened and one flat.
   */
  const across = lerp(13, 30, densityK)
  const pitchOf = (fo: Focal) =>
    clamp((2 * Math.max(fo.rx, fo.ry)) / across, u(20), u(56))

  const lead = focals[0] as Focal
  const ps = pitchOf(lead)
  const R = Math.max(lead.rx, lead.ry)

  // Screen angles. The separation between them is the whole point: two plates
  // at the same angle print a plaid, and 30-ish degrees apart print a rosette.
  const base = (36 + skel.range(-15, 15)) * (Math.PI / 180)
  const angGround = base + (18 + 38 * skew) * (Math.PI / 180)
  const angTint = base - 0.44
  const angRim = base + 1.22

  const pg = clamp(ps * 0.62, u(9), u(30))
  // The paper tint has a floor under its pitch as well as a ceiling. Below
  // about a dozen units the dot is sub-pixel on a phone-sized preview and the
  // screen stops being a texture and becomes an aliasing pattern — broad soft
  // diagonals across the ground that belong to the rasteriser, not the picture.
  const pf = clamp(ps * 0.3, u(12), u(19))

  /**
   * The surface of a form at a point: how far out it is, how lit it is, and how
   * close it is to the limb the light has left. Every mark on a form comes out
   * of these three, which is what keeps the screen, the rim and the accent
   * agreeing about where the light is.
   */
  type Surface = { m: number; tone: number; rim: number }
  const surfaceAt = (fo: Focal, x: number, y: number, peak: number): Surface | null => {
    const px = (x - fo.cx) / fo.rx
    const py = (y - fo.cy) / fo.ry
    const m2 = px * px + py * py
    if (m2 > 1) return null
    const m = Math.sqrt(m2)
    const nz = Math.sqrt(1 - m2)
    const lam = px * Lx + py * Ly + nz * Lz
    const band = Math.max(0, 1 - Math.abs(m - peak) / 0.16)
    return {
      m,
      // limb darkening, so the form turns away at its edge rather than reading
      // as a flat disc with a bright patch on it
      tone: clamp(Math.pow(clamp((lam + 0.1) / 1.02, 0, 1), 1.15) * (0.7 + 0.3 * nz), 0, 1),
      rim: band * band * clamp(0.25 - lam * 1.5, 0, 1),
    }
  }

  // --- the paper: one even fine screen, laid as a tile ----------------------
  // A background tint IS a uniform screen in print, and as a pattern it costs
  // one element instead of twenty thousand circles — which is what leaves the
  // budget for the dots that carry structure.
  defs.push(el('pattern',
    {
      id: `${ctx.uid}-tint`, patternUnits: 'userSpaceOnUse',
      width: pf, height: pf, patternTransform: `rotate(${f((angTint * 180) / Math.PI)})`,
    },
    el('circle', {
      cx: pf * 0.5, cy: pf * 0.5, r: pf * 0.2,
      fill: ctx.ramp(inkIsLight ? 0.36 : 0.26), opacity: inkIsLight ? 0.5 : 0.45,
    })))
  back.push(el('rect', { x: 0, y: 0, width: w, height: h, fill: `url(#${ctx.uid}-tint)` }))

  /**
   * The ground is a surface the light falls on, and the screen says so.
   *
   * The field used to be the same grid at a random radius per dot, which reads
   * as static. Here every ground dot answers to two terms: a shadow lobe thrown
   * by each form away from the light, and the pool of light that hugs the lit
   * side of it. Which of the two grows the dots depends on the ink — on paper
   * the shadow is where the ink piles up, on a dark ground the pool of light is.
   */
  const shadowAt = (x: number, y: number): number => {
    let best = 0
    for (const fo of focals) {
      const rad = Math.max(fo.rx, fo.ry)
      const sx = fo.cx - light.dx * rad * 0.42
      const sy = fo.cy - light.dy * rad * 0.42
      const d = Math.hypot((x - sx) / (fo.rx * 1.04), (y - sy) / (fo.ry * 1.04))
      let s = smoothstep(1.5, 0.55, d)
      // not a ring: the side facing the light keeps its paper
      const facing = ((x - fo.cx) * light.dx + (y - fo.cy) * light.dy) / rad
      s *= 0.42 + 0.58 * clamp(0.6 - facing * 0.75, 0, 1)
      if (s > best) best = s
    }
    return best
  }
  /**
   * The pool of light on the ground, and it is not a halo.
   *
   * Measured as a plain radius this came out as a ring of dots around the
   * subject — a glow, which is the one thing a printed direction must not have.
   * Compressing the distance along the light direction and stretching it away
   * makes the pool reach out across the lit side of the frame and stop short
   * behind the form, which is what a surface lit from one side looks like.
   */
  const poolAt = (x: number, y: number): number => {
    let best = 0
    for (const fo of focals) {
      const rad = Math.max(fo.rx, fo.ry)
      const dx = (x - fo.cx) / rad
      const dy = (y - fo.cy) / rad
      const along = dx * light.dx + dy * light.dy
      const perp = -dx * light.dy + dy * light.dx
      const q = smoothstep(1.45, 0.9, Math.hypot(along * (along > 0 ? 0.68 : 1.3), perp))
      if (q > best) best = q
    }
    return best
  }

  walkScreen(ctx, pg, angGround, { x0: 0, y0: 0, x1: w, y1: h }, (x, y) => {
    const sh = shadowAt(x, y)
    const struct = inkIsLight
      ? poolAt(x, y) * (1 - smoothstep(0.06, 0.52, sh))
      : sh
    if (struct < 0.08) return
    // low-frequency and multiplied, so the tint is unevenly inked the way a
    // press is rather than speckled the way a random radius is
    const n = ctx.fbm(ctx.n(x) * 0.0042, ctx.n(y) * 0.0042, 2)
    const cover = (0.03 + (0.30 + 0.52 * fieldK) * struct) * (0.86 + 0.22 * n)
    const r = pg * 0.5 * Math.sqrt(clamp(cover, 0, 1))
    if (r < u(0.6)) return
    back.push(el('circle', {
      cx: x, cy: y, r,
      fill: ctx.ramp(0.16 + 0.56 * clamp(cover, 0, 1)),
      opacity: 0.85,
    }))
  })

  // --- the forms ------------------------------------------------------------
  for (let k = 0; k < focals.length; k++) {
    const fo = focals[k] as Focal
    const p = k === 0 ? ps : pitchOf(fo)
    const ang = base + k * 0.62
    const peak = inkIsLight ? 0.93 : 0.88
    let hottest = 0

    walkScreen(ctx, p, ang, bboxOf(fo, 1.02), (x, y) => {
      const s = surfaceAt(fo, x, y, peak)
      if (!s) return
      if (s.tone > hottest) hottest = s.tone
      // ink coverage, quantised the way a posterised screen is, with a floor so
      // the far side still carries dots instead of falling back to bare ground
      let ink = 0.05 + 0.95 * (inkIsLight ? s.tone : 1 - s.tone)
      // Dark ink has already gone solid along the shadowed limb, so its rim
      // light is ink taken away rather than a brighter mark added — thinning
      // the screen there is the same edge, made the way the plate would make it.
      if (!inkIsLight) ink *= 1 - 0.72 * s.rim
      // a press does not ink evenly; a slow wobble keeps the solid end of the
      // screen from being a single flat value across half the form
      ink *= 0.95 + 0.09 * ctx.fbm(ctx.n(x) * 0.011, ctx.n(y) * 0.011, 2)
      const q = Math.round(clamp(ink, 0, 1) * steps) / steps
      const r = p * 0.47 * Math.sqrt(q)
      if (r < u(0.5)) return
      subject.push(el('circle', {
        cx: x, cy: y, r,
        fill: ctx.ramp(0.25 + 0.68 * q),
        opacity: 0.94,
      }))
    })

    /**
     * The second scale of detail, laid where the coarse screen is empty.
     *
     * Both halves of the pool want the same thing and want it in opposite
     * places. Where the ink is lighter than the paper the coarse screen dies on
     * the shadow side, the form dissolves into the ground, and the fine screen
     * has to be a rim light along the limb the light has left. Where the ink is
     * darker the coarse screen dies on the LIT side, so the fine screen carries
     * the highlight instead — the way a printer holds detail in a highlight,
     * with a finer ruling rather than a bigger dot.
     *
     * Both are ink over bare paper. Printing the fine screen on top of the
     * coarse one instead put a small paper dot in the middle of every big ink
     * dot, and a field of rings is not a texture, it is a fault.
     */
    const pr = p * 0.4
    walkScreen(ctx, pr, angRim, bboxOf(fo, 1.02), (x, y) => {
      const s = surfaceAt(fo, x, y, peak)
      if (!s) return
      const c = inkIsLight
        ? s.rim
        : smoothstep(0.4, 0.8, s.tone) * (1 - smoothstep(hottest - 0.26, hottest - 0.04, s.tone))
      const r = pr * 0.5 * Math.sqrt(c)
      if (r < u(0.4)) return
      subject.push(el('circle', {
        cx: x, cy: y, r,
        fill: ctx.ramp(inkIsLight ? 0.62 + 0.34 * c : 0.34 + 0.42 * c),
        opacity: 0.9,
      }))
    })

    /**
     * The accent as a second colour on the press, not as a stray pixel.
     *
     * One 1.5x dot in the accent was a dead pixel on the highlight; the same
     * cells recoloured whole is a hard-edged lozenge pasted on the form. This is
     * a third plate, deliberately out of register: it sits a half cell off the
     * ink screen so its dots land in the gaps, and its radius falls to nothing
     * at the edge of the hot spot so the cluster has no boundary to see.
     */
    if (k === 0) {
      walkScreen(ctx, p, ang, bboxOf(fo, 1.02), (x, y) => {
        const s = surfaceAt(fo, x, y, peak)
        if (!s) return
        const hotness = smoothstep(hottest - 0.3, hottest - 0.02, s.tone)
        const r = p * 0.3 * Math.sqrt(hotness)
        if (r < u(0.5)) return
        accentDots.push(el('circle', { cx: x, cy: y, r, fill: palette.accent }))
      }, 1)
    }
  }

  /**
   * The ring: a band, not a hairline.
   *
   * Two concentric ellipses at the same flattening give a band that thins at
   * the front and back the way a real ring does, and knocking a fine stripe
   * screen out of it in the paper colour gives the picture a second kind of
   * mark against all those dots. The whole band goes behind the form, where the
   * form occludes it, and the near half is printed again in front, so the ring
   * passes through the sphere instead of lying across it.
   */
  if (ringK > 0.06) {
    const tilt = skel.range(-0.3, 0.3)
    const cs = Math.cos(tilt)
    const sn = Math.sin(tilt)
    const rxo = R * lerp(1.44, 1.86, skel.next())
    const ryo = rxo * skel.range(0.2, 0.32)
    const bandW = R * (0.14 + 0.26 * ringK)
    const rxi = Math.max(R * 1.08, rxo - bandW)
    const ryi = ryo * (rxi / rxo)

    const arc = (from: number, span: number, rx: number, ry: number, out: number[]) => {
      const N = 30
      for (let i = 0; i <= N; i++) {
        const a = from + (span * i) / N
        const ex = Math.cos(a) * rx
        const ey = Math.sin(a) * ry
        out.push(lead.cx + ex * cs - ey * sn, lead.cy + ex * sn + ey * cs)
      }
    }
    const halfBand = (from: number): string => {
      const pts: number[] = []
      arc(from, Math.PI, rxo, ryo, pts)
      arc(from + Math.PI, -Math.PI, rxi, ryi, pts)
      return poly(pts, true)
    }
    const near = halfBand(0)
    const fullBand = near + halfBand(Math.PI)

    const sp = u(8.5)
    defs.push(el('pattern',
      {
        id: `${ctx.uid}-ringink`, patternUnits: 'userSpaceOnUse',
        width: sp, height: sp, patternTransform: `rotate(${f((tilt * 180) / Math.PI)})`,
      },
      el('rect', { x: 0, y: 0, width: sp * 0.44, height: sp, fill: palette.ground })))

    /**
     * Both halves take the same ink.
     *
     * Printing the near half stronger put a value step across the band at the
     * two points where the halves meet, out past the form where nothing
     * occludes anything — a hook on the end of the ring that read as a mistake.
     * Depth here is occlusion and nothing else: the form covers the far half
     * and the near half covers the form, which is the whole of the effect.
     */
    const ink = ctx.ramp(0.52)
    behind.push(el('path', { d: fullBand, fill: ink, opacity: 0.88 }))
    behind.push(el('path', { d: fullBand, fill: `url(#${ctx.uid}-ringink)`, opacity: 0.55 }))
    front.push(el('path', { d: near, fill: ink, opacity: 0.88 }))
    front.push(el('path', { d: near, fill: `url(#${ctx.uid}-ringink)`, opacity: 0.55 }))
  }

  const scene: Scene = { back, behind, subject, front, defs }
  if (accentDots.length) scene.accent = group({}, accentDots)
  return scene
}

export const halftoneSphere: Renderer = {
  id: 'halftone-sphere',
  name: 'Halftone Sphere',
  family: 'retro-pop',
  dark: true,
  focals: ['circle', 'disc', 'ellipse'],
  sampler: 'grid',
  schema,
  render,
}
