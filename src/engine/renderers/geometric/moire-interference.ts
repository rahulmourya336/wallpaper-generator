import { clamp, el, group, lerp, poly } from '../../svg'
import { mixHex } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Two ring families a hair out of step with each other.
 *
 * This used to be drawn literally: two dense sets of identical hairlines laid
 * over each other and left to interfere on the retina. At phone size that reads
 * as a scanned CD — a couple of hundred equal circles, edge to edge, no scale
 * to rest on and no ground to breathe in.
 *
 * The interference is computed here instead. Every mark knows the phase
 * difference between the two lattices at the point where it is drawn, and
 * spends it on WEIGHT and VALUE as well as on position: where the two families
 * coincide the stroke swells and lights up, where they interleave it drops to a
 * dim thread. The fringes then become the subject — bands built out of a couple
 * of thousand tapering strokes — rather than an optical accident of a texture.
 * A few percent of detune between the two spacings is all it takes; the old
 * default put the centres a fifth of the frame apart at identical spacing,
 * which is dozens of fringes, which is a blur.
 *
 * Everything is sampled from one shape metric, so a circle, an ellipse and a
 * rounded diamond all interfere by the same arithmetic, and everything is
 * emitted as polylines — dense arc geometry is what makes the Rust rasteriser
 * abort on this style.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'offset', label: 'Separation', type: 'range', min: 0, max: 2, step: 0.02, default: 0.75 },
  { key: 'detune', label: 'Detune', type: 'range', min: 0.02, max: 0.2, step: 0.005, default: 0.09 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.5, max: 2.2, step: 0.01, default: 1.1 },
  { key: 'third', label: 'Third set', type: 'range', min: 0, max: 1, step: 0.01, default: 0.34 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'diamond'], default: 'auto' },
]

const TAU = Math.PI * 2

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette } = ctx
  const densityK = ctx.num('density')
  const sepK = ctx.num('offset')
  const detuneK = ctx.num('detune')
  const falloffK = ctx.num('falloff')
  const weightK = ctx.num('weight')
  const thirdK = ctx.num('third')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []
  const defs: string[] = []

  const marks: string[] = []
  const lit: string[] = []

  // --- the geometry the whole family is measured in ------------------------
  // One metric decides both where a ring goes and how far any point is from a
  // centre, which is what lets ellipses and rounded diamonds beat against each
  // other as cleanly as circles do.
  const want = ctx.str('form')
  const kind = want === 'auto' ? focal.kind : want
  const squash = kind === 'ellipse' ? clamp(focal.ry / Math.max(focal.rx, 1), 0.62, 1.5) : 1
  const power = kind === 'diamond' ? 1.8 : 2

  const metric = (dx: number, dy: number): number => {
    const b = dy / squash
    return power === 2
      ? Math.hypot(dx, b)
      : Math.pow(Math.pow(Math.abs(dx), power) + Math.pow(Math.abs(b), power), 1 / power)
  }
  const shapeAt = (r: number, th: number): [number, number] => {
    const co = Math.cos(th)
    const si = Math.sin(th)
    const g = power === 2
      ? 1
      : Math.pow(Math.pow(Math.abs(co), power) + Math.pow(Math.abs(si), power), -1 / power)
    return [r * g * co, r * g * si * squash]
  }

  const rx = Math.max(focal.rx, u(70))
  // The pattern is a subject, not a field: it runs out to a stated extent and
  // the ground past that is bare. Everything else here is a fraction of it.
  const extent = rx * lerp(2.15, 1.24, falloffK)
  const ext = extent / rx
  const spacing = u(lerp(24, 9, densityK))

  // --- how the two lattices are put out of step ---------------------------
  // The spacing itself is detuned, which is what turns the beat into a handful
  // of broad bands standing across the rings. Separating the centres as well
  // does NOT add fringes, it leans those bands to one side: a beat band sits at
  // r = k/e - D cos(theta)/e, so a separation of one ring spacing displaces the
  // whole family by exactly one band. Pushed much past that the bands cusp, and
  // pure separation with no detune degenerates into a sunburst of straight
  // radial wedges — the same picture a starburst test chart makes.
  const lean = ctx.light
  const angle = Math.atan2(lean.dy, lean.dx) + skel.range(-0.5, 0.5)
  const sep = spacing * clamp(sepK * skel.range(0.55, 1.15), 0.12, 1.3)
  const ratio = 1 + clamp(detuneK * skel.range(0.8, 1.25), 0.03, 0.2)
  const phase = skel.next()

  const ax = focal.cx
  const ay = focal.cy
  const bx = ax + Math.cos(angle) * sep
  const by = ay + Math.sin(angle) * sep
  // The third centre sits exactly on the line through the first two, at twice
  // the separation, so it beats at twice the rate and lands on every second
  // fringe. Anywhere else and the fringes stop being a family and become smear.
  const cx3 = ax + Math.cos(angle) * sep * 2
  const cy3 = ay + Math.sin(angle) * sep * 2

  const sA = spacing
  const sB = spacing * ratio
  const sC = spacing * ratio * ratio

  /** 1 where the two lattices coincide, 0 where they interleave. */
  const beat = (x: number, y: number): number =>
    0.5 + 0.5 * Math.cos(TAU * (metric(x - ax, y - ay) / sA - metric(x - bx, y - by) / sB - phase))
  const beat3 = (x: number, y: number): number =>
    0.5 + 0.5 * Math.cos(TAU * (metric(x - ax, y - ay) / sA - metric(x - cx3, y - cy3) / sC - phase * 2))

  const baseW = u(weightK * 2.3)
  const ringsA = Math.ceil(extent / sA)
  // the fringe band the accent will inhabit, chosen near the focal radius
  const accentRing = clamp(Math.round((rx * skel.range(0.84, 1.04)) / sA), 3, Math.max(3, ringsA - 2))
  const accentHalf = 2.4

  let drawn = 0

  const drawSet = (
    ox: number, oy: number, s: number, op: number, phaseOf: (x: number, y: number) => number,
    cull: number, thin: number, accentable: boolean,
  ) => {
    const rings = Math.ceil(extent / s) + 2
    for (let i = 1; i <= rings; i++) {
      if ((i & 3) === 0 && ctx.expired()) return
      if (drawn > 3400) return
      const r = i * s
      const bell = accentable
        ? Math.max(0, Math.cos((Math.abs(i - accentRing) / (accentHalf + 0.7)) * (Math.PI / 2))) ** 2
        : 0
      // The beat turns slowly around a ring, so the swell only needs enough
      // chopping to stay a swell. The golden-angle offset matters more than the
      // count: with every ring cut at the same angles the joints stack up into
      // radial seams, and thirty of those read as a rectangle laid over the
      // pattern. Scattered, they are invisible.
      const span = clamp(Math.round((TAU * r) / u(30)), 12, 40)
      const step = TAU / span
      const off = ((i * 0.6180339887) % 1) * step
      for (let j = 0; j < span; j++) {
        const th0 = j * step + off
        const [mx, my] = shapeAt(r, th0 + step * 0.5)
        const px = ox + mx
        const py = oy + my
        const dx = px - ax
        const dy = py - ay
        const t = metric(dx, dy) / rx
        const outer = 1 - smoothstep(0.96, ext, t)
        if (outer <= 0.004) continue
        // The heart is left to the fine lattice: coarse rings a spacing or two
        // across are a scribble at any size, and they cost the composition the
        // one place it has to be quiet.
        const inner = smoothstep(0.06, 0.6, t)
        const c = phaseOf(px, py)
        if (c < cull) continue
        // A set that only shows on its own crests has to arrive and leave, or
        // its arcs end mid-air and the whole picture is scratched with dashes.
        const gate = cull > 0.05 ? smoothstep(cull, cull + 0.22, c) : 1
        // which side of the ring faces the light, worth a few percent of value
        const lam = t > 0.001 ? (dx * lean.dx + dy * lean.dy) / (t * rx) : 0

        // value: a dark heart, a lit rim on the strong bands, and everything
        // sinking back toward the ground as the pattern runs out
        const tone01 = (0.22 + 0.28 * inner + 0.38 * c) * (0.93 + 0.09 * lam)
        const tone = 0.14 + (tone01 - 0.14) * (0.34 + 0.66 * outer)
        const width = baseW * thin * (0.34 + 1.45 * c ** 1.4) * (0.44 + 0.56 * outer)
        const alpha =
          op * gate * (0.18 + 0.82 * inner) * outer * (0.26 + 0.74 * c ** 1.05) * (0.92 + 0.1 * lam)
        if (alpha < 0.035 || width < u(0.2)) continue

        const steps = clamp(Math.ceil(step / 0.11), 2, 9)
        const pts: number[] = []
        for (let k = 0; k <= steps; k++) {
          const [qx, qy] = shapeAt(r, th0 + (step * k) / steps)
          pts.push(ox + qx, oy + qy)
        }
        const stroke = bell > 0.02 ? mixHex(ctx.ramp(tone), palette.accent, bell * 0.85) : ctx.ramp(tone)
        const seg = el('path', {
          d: poly(pts),
          stroke,
          'stroke-width': width * (1 + 0.28 * bell),
          opacity: Math.min(1, alpha * (1 + 0.28 * bell)),
        })
        drawn++
        if (bell > 0.02) lit.push(seg)
        else marks.push(seg)
      }
    }
  }

  // --- the light the interference sits in ----------------------------------
  defs.push(el('radialGradient',
    { id: `${ctx.uid}-mo-glow`, gradientUnits: 'userSpaceOnUse', cx: ax, cy: ay, r: rx * 0.8 },
    el('stop', { offset: 0, 'stop-color': ctx.ramp(0.82), 'stop-opacity': 0.15 }) +
    el('stop', { offset: 0.5, 'stop-color': ctx.ramp(0.82), 'stop-opacity': 0.06 }) +
    el('stop', { offset: 1, 'stop-color': ctx.ramp(0.82), 'stop-opacity': 0 })))
  front.push(el('circle', { cx: ax, cy: ay, r: rx * 0.8, fill: `url(#${ctx.uid}-mo-glow)` }))

  // --- second scale: a fine lattice in the heart ---------------------------
  // Three to a coarse ring, so it beats against the coarse set too, and gone
  // well before the coarse pattern is. Something to find at arm's length.
  const fine: string[] = []
  const fs = sA / 3
  const fineTo = rx * 0.58
  for (let k = 1; k * fs < fineTo; k++) {
    if ((k & 7) === 0 && ctx.expired()) break
    const r = k * fs
    const fade = (1 - smoothstep(rx * 0.3, fineTo, r)) * smoothstep(fs * 1.5, fs * 6, r)
    if (fade <= 0.01) continue
    const pts: number[] = []
    for (let j = 0; j < 72; j++) {
      const [qx, qy] = shapeAt(r, (j / 72) * TAU)
      pts.push(ax + qx, ay + qy)
    }
    fine.push(el('path', {
      d: poly(pts, true),
      stroke: ctx.ramp(0.5),
      'stroke-width': u(0.7 + 0.45 * (0.5 + 0.5 * Math.sin(k * 0.8))),
      opacity: 0.16 * fade,
    }))
  }
  front.push(group({ fill: 'none' }, fine))

  // --- the two families, and the sparse third ------------------------------
  if (thirdK > 0.05) {
    drawSet(cx3, cy3, sC, 0.2 + 0.34 * thirdK, beat3, lerp(0.72, 0.4, thirdK), 0.72, false)
  }
  drawSet(bx, by, sB, 0.74, beat, 0.02, 0.88, false)
  drawSet(ax, ay, sA, 1, beat, 0.02, 1, true)

  front.push(group({ fill: 'none', 'stroke-linejoin': 'round' }, marks))

  const accent = lit.length > 0
    ? group({ fill: 'none', 'stroke-linejoin': 'round' }, lit)
    : undefined

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const moireInterference: Renderer = {
  id: 'moire-interference',
  name: 'Moiré Interference',
  family: 'geometric',
  dark: true,
  focals: ['circle', 'ellipse', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
