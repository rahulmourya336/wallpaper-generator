import { clamp, el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A harmonograph trace, on the plate it was drawn on.
 *
 * Two pendulums per axis, each swinging at its own frequency and phase and
 * losing amplitude as it goes. The pen draws the sum. Nothing about the figure
 * is designed: the whole shape is four frequencies and four decays, and the
 * near-misses between frequencies are what open the envelope out into a
 * ribbon instead of closing it into a single loop. That is why frequency
 * ratios here are set as a whole number plus a small detune rather than as
 * free numbers — an exact ratio retraces itself and draws one thin line.
 *
 * Two things separate a machine plot from a screen grab of a curve.
 *
 * The first is that a real pen has a time axis in it. The damping moves the
 * geometry, so a trace at uniform weight says the swing shrank while the ink
 * did not — which no instrument has ever done. Every stroke here is cut into
 * a few dozen pieces and each piece takes its width, its opacity and its place
 * on the ramp from the pendulum amplitude at that moment, plus a thickening
 * wherever the pen is moving slowly and the ink pools. Heavy and bright at the
 * first loop, a dry hairline at the last.
 *
 * The second is that the drawing sits on something. The subject is a ruled
 * plate — graticule, origin crosshair, scale bar, corner registration, a step
 * wedge — with a hard edge and an offset shadow, and the hero figure is drawn
 * large enough to run straight off it and out of the frame. Trace over paper
 * over ground, three planes, instead of one squiggle floating on a tint.
 *
 * Ink or phosphor is chosen by the ground rather than by taste: a glow on a
 * light ground is a grey smear, and a bare hairline on a near-black ground has
 * nothing to be seen against.
 */

const schema: ParamSchema = [
  { key: 'figures', label: 'Traces', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'detune', label: 'Detune', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'decay', label: 'Damping', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'complexity', label: 'Ratio', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'glow', label: 'Phosphor', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'plate', label: 'Plate', type: 'range', min: 0, max: 1, step: 0.01, default: 0.72 },
  { key: 'rules', label: 'Graticule', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'lens', 'diamond'], default: 'auto' },
]

type Pendulum = { freq: number; phase: number; amp: number; decay: number }

type Trace = {
  px: number[]
  py: number[]
  /** pen amplitude, renormalised to 1 at the first sample and 0 at the last */
  env: number[]
  /** step length per sample, and its mean, for the ink pooling */
  spd: number[]
  ref: number
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette, light } = ctx
  const figuresK = ctx.num('figures')
  const detuneK = ctx.num('detune')
  const decayK = ctx.num('decay')
  const complexityK = ctx.num('complexity')
  const glowK = ctx.num('glow')
  const weightK = ctx.num('weight')
  const plateK = ctx.num('plate')
  const rulesK = ctx.num('rules')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const cx = focal.cx
  const cy = focal.cy
  const reach = Math.max(focal.rx, focal.ry)
  const phosphor = palette.mode === 'dark'

  // --- the pendulums -------------------------------------------------------

  // A whole-number ratio with a small offset. Exactly 2:1 retraces itself
  // forever and draws one line; 2:1 plus a hundredth precesses, and the
  // precession is the drawing.
  const ratio = () =>
    Math.round(lerp(1, 5, complexityK * skel.next())) +
    skel.range(-1, 1) * lerp(0.002, 0.06, detuneK)

  const pendulum = (amp: number): Pendulum => ({
    freq: ratio(),
    phase: skel.range(0, Math.PI * 2),
    amp,
    decay: lerp(0.05, 0.6, decayK) * skel.range(0.7, 1.3),
  })

  /**
   * Sample density is fixed to the skeleton so the curve is the same curve at
   * every quality; only the stroke weights answer to the render size. The
   * envelope is kept alongside the points because the pen needs it: it is the
   * amplitude still left in the swing, which is what decides how much ink the
   * nib is laying down at that moment.
   */
  const trace = (ox: number, oy: number, scale: number, revs: number, per: number): Trace => {
    const xs: [Pendulum, Pendulum] = [pendulum(scale * 0.62), pendulum(scale * 0.4)]
    const ys: [Pendulum, Pendulum] = [pendulum(scale * 0.62), pendulum(scale * 0.4)]
    const steps = Math.max(64, Math.round(revs * per))
    const total = xs[0].amp + xs[1].amp + ys[0].amp + ys[1].amp
    const px: number[] = []
    const py: number[] = []
    const amp: number[] = []
    const spd: number[] = [0]
    let sum = 0
    for (let s = 0; s <= steps; s++) {
      if ((s & 1023) === 0 && ctx.expired()) break
      const tn = s / steps
      const t = tn * revs
      // Damping decides how much of the frame the figure occupies, not just
      // how it ends. Run it hard and every seed collapses into a knot of line
      // in the middle of an empty picture.
      const d0 = Math.exp(-xs[0].decay * tn * 1.5)
      const d1 = Math.exp(-xs[1].decay * tn * 1.5)
      const e0 = Math.exp(-ys[0].decay * tn * 1.5)
      const e1 = Math.exp(-ys[1].decay * tn * 1.5)
      const x =
        ox +
        xs[0].amp * Math.sin(xs[0].freq * t + xs[0].phase) * d0 +
        xs[1].amp * Math.sin(xs[1].freq * t + xs[1].phase) * d1
      const y =
        oy +
        ys[0].amp * Math.sin(ys[0].freq * t + ys[0].phase) * e0 +
        ys[1].amp * Math.sin(ys[1].freq * t + ys[1].phase) * e1
      if (s > 0) {
        const dl = Math.hypot(x - (px[s - 1] as number), y - (py[s - 1] as number))
        spd.push(dl)
        sum += dl
      }
      px.push(x)
      py.push(y)
      amp.push((xs[0].amp * d0 + xs[1].amp * d1 + ys[0].amp * e0 + ys[1].amp * e1) / total)
    }
    spd[0] = spd[1] ?? 1
    const last = px.length - 1
    const a0 = amp[0] ?? 1
    const a1 = amp[last] ?? 0
    // A figure that barely damps would otherwise get no time axis at all, so
    // the envelope is renormalised to the run it actually made rather than to
    // an absolute amplitude.
    const drop = a0 - a1
    const env = amp.map((a, i) =>
      drop < 1e-3 ? 1 - i / Math.max(1, last) : clamp((a - a1) / drop, 0, 1))
    return { px, py, env, spd, ref: Math.max(1e-6, sum / Math.max(1, last)) }
  }

  /**
   * One polyline, drawn as forty-odd short strokes.
   *
   * A single path can only carry one width and one colour, which is the whole
   * reason the old trace read as a screen grab. Cutting it up costs nothing —
   * the point data is the same — and buys width, opacity and value that all
   * move together along the line.
   */
  const strokeTrace = (
    tr: Trace,
    from: number,
    to: number,
    w0: number,
    hi: number,
    lo: number,
    aHi: number,
    aLo: number,
    halo: number,
    fixed?: string,
  ): string => {
    const n = tr.px.length - 1
    const i0 = Math.max(0, Math.round(from * n))
    const i1 = Math.min(n, Math.round(to * n))
    const span = i1 - i0
    if (span < 16) return ''
    const chunks = clamp(Math.round(span / 44), 8, 72)
    let wide = ''
    let core = ''
    for (let c = 0; c < chunks; c++) {
      const a = i0 + Math.floor((c * span) / chunks)
      const b = i0 + Math.floor(((c + 1) * span) / chunks)
      if (b <= a) continue
      let d = `M${f(tr.px[a] as number)} ${f(tr.py[a] as number)}`
      let run = 0
      for (let i = a + 1; i <= b; i++) {
        d += `L${f(tr.px[i] as number)} ${f(tr.py[i] as number)}`
        run += tr.spd[i] as number
      }
      const e = tr.env[(a + b) >> 1] as number
      // Ink pools on the slow passages — the cusps at the ends of a swing,
      // where the pen dwells — and thins where it is thrown across the sheet.
      const pace = Math.max(run / (b - a), tr.ref * 0.12)
      const pool = clamp((tr.ref / pace) ** 0.5, 0.72, 1.9)
      const width = w0 * (0.28 + 0.72 * e) * pool
      const alpha = lerp(aLo, aHi, e)
      const col = fixed ?? ctx.ramp(lerp(lo, hi, e))
      if (halo > 0) {
        wide += el('path', {
          d, fill: 'none', stroke: withAlpha(col, alpha * 0.11 * (0.4 + 0.6 * glowK)),
          'stroke-width': width * halo, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        })
      }
      core += el('path', {
        d, fill: 'none', stroke: alpha > 0.985 ? col : withAlpha(col, alpha),
        'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      })
    }
    return wide + core
  }

  // --- the plate -----------------------------------------------------------
  // The focal form arrives as a flat tint, which is a colour block and not an
  // object. Covered outright by a card of the same size: the tint becomes the
  // paper's shadow side and the drawing gets somewhere to be printed.

  const turn = skel.range(-13, 13)
  const ca = Math.cos((turn * Math.PI) / 180)
  const sa = Math.sin((turn * Math.PI) / 180)
  // Never smaller than the form it stands in for, or the tint shows past its
  // edge as a crescent of the wrong colour.
  const pw = reach * (1.05 + 0.4 * plateK * skel.next())
  const ph = reach * (1.06 + 0.62 * plateK * skel.next())
  const P = (lx: number, ly: number): [number, number] => [
    cx + lx * ca - ly * sa,
    cy + lx * sa + ly * ca,
  ]
  const seg = (ax: number, ay: number, bx: number, by: number): string => {
    const A = P(ax, ay)
    const B = P(bx, by)
    return `M${f(A[0])} ${f(A[1])}L${f(B[0])} ${f(B[1])}`
  }
  const quad = (x0: number, y0: number, x1: number, y1: number): string => {
    const c = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)]
    return `M${f(c[0]![0])} ${f(c[0]![1])}L${f(c[1]![0])} ${f(c[1]![1])}` +
      `L${f(c[2]![0])} ${f(c[2]![1])}L${f(c[3]![0])} ${f(c[3]![1])}Z`
  }
  const plateD = quad(-pw, -ph, pw, ph)

  const paper = phosphor
    ? mixHex(ctx.ramp(0.11), palette.ground, 0.32)
    : mixHex(ctx.ramp(0.05), palette.ground, palette.mode === 'light' ? 0.62 : 0.3)
  const edgeTone = ctx.ramp(palette.mode === 'light' ? 0.72 : 0.46)

  // A hard offset shadow, away from the light. Soft shadows belong to
  // photographs; this direction is printed, and a sheet on a desk casts a
  // hard-edged copy of itself one step down-light.
  front.push(el('path', {
    d: plateD, fill: palette.ink, opacity: 0.24,
    transform: `translate(${f(-light.dx * u(9))} ${f(-light.dy * u(9))})`,
  }))
  front.push(el('path', { d: plateD, fill: paper }))

  // --- the graticule -------------------------------------------------------
  // Three weights, not one: hair rule, fifth rule, and the instrument marks
  // that sit above both.
  const grid = ctx.short * lerp(0.078, 0.042, rulesK)
  let hair = ''
  let rule = ''
  let mark = ''

  const gx = Math.min(30, Math.floor(pw / grid))
  const gy = Math.min(40, Math.floor(ph / grid))
  for (let i = -gx; i <= gx; i++) {
    const d = seg(i * grid, -ph, i * grid, ph)
    if (i % 5 === 0) rule += d
    else hair += d
  }
  for (let j = -gy; j <= gy; j++) {
    const d = seg(-pw, j * grid, pw, j * grid)
    if (j % 5 === 0) rule += d
    else hair += d
  }

  // The pendulum origin, broken at the centre so the crosshair reads as a
  // registration and not as two lines crossing.
  const gap = u(12)
  const arm = Math.min(pw, ph) * 0.58
  mark += seg(gap, 0, arm, 0) + seg(-gap, 0, -arm, 0)
  mark += seg(0, gap, 0, arm) + seg(0, -gap, 0, -arm)

  // Scale bar along the lower margin: three tick lengths, so the eye can count
  // by fives without being told to.
  const barY = ph - u(34)
  const barX = pw * 0.52
  const halfStep = grid * 0.5
  const bars = Math.floor((barX * 2) / halfStep)
  mark += seg(-barX, barY, -barX + bars * halfStep, barY)
  for (let k = 0; k <= bars; k++) {
    const lx = -barX + k * halfStep
    if (k % 10 === 0) mark += seg(lx, barY, lx, barY - u(14))
    else if (k % 5 === 0) mark += seg(lx, barY, lx, barY - u(9))
    else rule += seg(lx, barY, lx, barY - u(4.5))
  }

  // Corner registration: an L at each corner, and one true register cross.
  const inset = u(22)
  const crop = u(18)
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const bx = sx * (pw - inset)
    const by = sy * (ph - inset)
    mark += seg(bx, by, bx - sx * crop, by) + seg(bx, by, bx, by - sy * crop)
  }
  const reg = P(-pw + u(46), -ph + u(46))
  mark += `M${f(reg[0] - u(15))} ${f(reg[1])}L${f(reg[0] + u(15))} ${f(reg[1])}` +
    `M${f(reg[0])} ${f(reg[1] - u(15))}L${f(reg[0])} ${f(reg[1] + u(15))}`

  front.push(el('path', {
    d: hair, fill: 'none', stroke: withAlpha(ctx.ramp(0.5), 0.16), 'stroke-width': u(0.9),
  }))
  front.push(el('path', {
    d: rule, fill: 'none', stroke: withAlpha(ctx.ramp(0.55), 0.34), 'stroke-width': u(1.8),
  }))
  front.push(el('path', {
    d: mark, fill: 'none', stroke: withAlpha(ctx.ramp(0.7), 0.72), 'stroke-width': u(1.6),
    'stroke-linecap': 'square',
  }))
  front.push(el('circle', {
    cx: reg[0], cy: reg[1], r: u(9), fill: 'none',
    stroke: withAlpha(ctx.ramp(0.7), 0.72), 'stroke-width': u(1.4),
  }))
  front.push(el('circle', {
    cx, cy, r: u(8), fill: 'none',
    stroke: withAlpha(ctx.ramp(0.75), 0.8), 'stroke-width': u(1.6),
  }))

  // A step wedge. Four flat patches climbing the ramp, which is both the
  // instrument's own calibration and the picture's statement of its values.
  const wedgeX = -pw + u(34)
  const wedgeY = ph - u(78)
  for (let k = 0; k < 4; k++) {
    front.push(el('path', {
      d: quad(wedgeX + k * u(17), wedgeY, wedgeX + k * u(17) + u(14), wedgeY + u(15)),
      fill: withAlpha(ctx.ramp(0.24 + k * 0.24), 0.82),
    }))
  }

  // The edge last, over its own ruling, so the card ends on a crisp line.
  front.push(el('path', {
    d: plateD, fill: 'none', stroke: withAlpha(edgeTone, 0.65), 'stroke-width': u(1.6),
  }))

  // --- the secondary figures ----------------------------------------------
  // Small, dense and drawn with a fine pen: the scale contrast is the point,
  // and three figures of similar size piled on the middle was the old fault.

  const spots: readonly (readonly [number, number])[] = [
    [-0.56, 0.56], [0.58, -0.54], [0.5, 0.74], [-0.6, -0.6],
  ]
  const smalls = 1 + Math.round(lerp(0, 2, figuresK))
  const offset = skel.int(0, 3)
  for (let si = 0; si < smalls; si++) {
    if (ctx.expired()) break
    const spot = spots[(si + offset) % spots.length] as readonly [number, number]
    const lx = spot[0] * pw * skel.range(0.88, 1.05)
    const ly = spot[1] * ph * skel.range(0.88, 1.05)
    const at = P(lx, ly)
    const scale = reach * lerp(0.2, 0.34, skel.next())
    const revs = lerp(24, 52, complexityK) * skel.range(0.9, 1.2)
    const tr = trace(at[0], at[1], scale, revs, 52)

    // A ruled box around the first one only: one detail call-out reads as a
    // measurement, three read as a form.
    if (si === 0) {
      const b = scale * 1.42
      front.push(el('path', {
        d: quad(lx - b, ly - b, lx + b, ly + b), fill: 'none',
        stroke: withAlpha(ctx.ramp(0.55), 0.42), 'stroke-width': u(1.3),
      }))
      front.push(el('path', {
        d: seg(lx - b, ly - b - u(9), lx - b + u(13), ly - b - u(9)),
        fill: 'none', stroke: withAlpha(ctx.ramp(0.7), 0.6), 'stroke-width': u(1.5),
      }))
    }
    front.push(strokeTrace(
      tr, 0, 1, u(1.55 * weightK),
      palette.mode === 'light' ? 0.95 : 0.78, 0.4, 0.92, 0.42, 0,
    ))
    front.push(el('path', {
      d: seg(lx - u(9), ly, lx + u(9), ly) + seg(lx, ly - u(9), lx, ly + u(9)),
      fill: 'none', stroke: withAlpha(ctx.ramp(0.62), 0.5), 'stroke-width': u(1.2),
    }))
  }

  // --- the hero trace ------------------------------------------------------
  // Wide enough that its first loops leave the plate and then the frame; by
  // the time it has damped down to the origin it is a dry hairline.

  const heroScale = reach * lerp(1.3, 1.62, skel.next())
  const heroRevs = lerp(14, 46, complexityK)
  const hero = trace(cx, cy, heroScale, heroRevs, 78)
  const heroW = u((phosphor ? 4.4 : 5.2) * weightK)
  const halo = phosphor ? lerp(3.5, 6.5, glowK) : 0

  // The accent has a place instead of a colour: the opening swing only, where
  // the pen is heaviest, so the eye starts where the machine did.
  const lead = 0.28
  let accent = strokeTrace(hero, 0, lead, heroW, 1, 1, 1, 0.86, halo, palette.accent)

  front.push(strokeTrace(
    hero, lead, 1, heroW,
    palette.mode === 'light' ? 1 : 0.88, 0.36, 0.96, 0.34, halo,
  ))

  // The pen at rest, at the end of the trace rather than at the origin it
  // never quite reached.
  const endIdx = hero.px.length - 1
  const ex = hero.px[endIdx] as number
  const ey = hero.py[endIdx] as number
  const nib = ctx.ramp(0.95)
  const penHead =
    el('path', {
      d: `M${f(ex - ca * u(15))} ${f(ey - sa * u(15))}L${f(ex + ca * u(15))} ${f(ey + sa * u(15))}` +
        `M${f(ex + sa * u(15))} ${f(ey - ca * u(15))}L${f(ex - sa * u(15))} ${f(ey + ca * u(15))}`,
      fill: 'none', stroke: withAlpha(nib, 0.7), 'stroke-width': u(1.3),
    }) +
    el('circle', { cx: ex, cy: ey, r: u(7), fill: 'none', stroke: nib, 'stroke-width': u(1.8) }) +
    el('circle', { cx: ex, cy: ey, r: u(2.2), fill: nib })
  front.push(penHead)

  if (!accent) accent = el('circle', { cx: ex, cy: ey, r: u(6), fill: palette.accent })

  return { back, behind, subject, front, accent }
}

export const harmonograph: Renderer = {
  id: 'harmonograph',
  name: 'Harmonograph',
  family: 'technical',
  dark: true,
  focals: ['circle', 'lens', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
