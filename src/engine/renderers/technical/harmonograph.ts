import { el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A harmonograph trace.
 *
 * Two pendulums per axis, each swinging at its own frequency and phase and
 * losing amplitude as it goes. The pen draws the sum. Nothing about the figure
 * is designed: the whole shape is four frequencies and four decays, and the
 * near-misses between frequencies are what open the envelope out into a
 * ribbon instead of closing it into a single loop. That is why frequency
 * ratios here are set as a whole number plus a small detune rather than as
 * free numbers — an exact ratio retraces itself and draws one thin line.
 *
 * Drawn as phosphor rather than ink. Three passes of the same path, wide and
 * nearly transparent through to thin and bright, give a glow that costs three
 * strokes instead of a filter region the size of the frame. At export scale
 * that difference is seconds.
 */

const schema: ParamSchema = [
  { key: 'figures', label: 'Traces', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'detune', label: 'Detune', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'decay', label: 'Damping', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'complexity', label: 'Ratio', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'glow', label: 'Phosphor', type: 'range', min: 0, max: 1, step: 0.01, default: 0.65 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'lens', 'diamond'], default: 'auto' },
]

type Pendulum = { freq: number; phase: number; amp: number; decay: number }

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette, uid } = ctx
  const figuresK = ctx.num('figures')
  const detuneK = ctx.num('detune')
  const decayK = ctx.num('decay')
  const complexityK = ctx.num('complexity')
  const glowK = ctx.num('glow')
  const weightK = ctx.num('weight')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const cx = focal.cx
  const cy = focal.cy
  const reach = Math.max(focal.rx, focal.ry)

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
    decay: lerp(0.04, 0.5, decayK) * skel.range(0.7, 1.3),
  })

  const figures = Math.round(lerp(1, 5, figuresK))
  const revolutions = lerp(14, 46, complexityK)
  // Sample density is fixed to the skeleton so the curve is the same curve at
  // every quality; only the stroke weights answer to the render size.
  const steps = Math.round(revolutions * 78)

  let accent: string | undefined

  for (let fi = 0; fi < figures; fi++) {
    if (ctx.expired()) break
    const scale = reach * lerp(1.25, 0.5, fi / Math.max(1, figures - 1)) * skel.range(0.9, 1.1)
    const xs: [Pendulum, Pendulum] = [pendulum(scale * 0.62), pendulum(scale * 0.4)]
    const ys: [Pendulum, Pendulum] = [pendulum(scale * 0.62), pendulum(scale * 0.4)]
    const turn = skel.range(0, 180)

    let d = ''
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * revolutions
      // Damping decides how much of the frame the figure occupies, not just
      // how it ends. Run it hard and every seed collapses into a knot of line
      // in the middle of an empty picture.
      const damp = (pen: Pendulum) => Math.exp(-pen.decay * (t / revolutions) * 1.5)
      const x =
        cx +
        xs[0].amp * Math.sin(xs[0].freq * t + xs[0].phase) * damp(xs[0]) +
        xs[1].amp * Math.sin(xs[1].freq * t + xs[1].phase) * damp(xs[1])
      const y =
        cy +
        ys[0].amp * Math.sin(ys[0].freq * t + ys[0].phase) * damp(ys[0]) +
        ys[1].amp * Math.sin(ys[1].freq * t + ys[1].phase) * damp(ys[1])
      d += `${s === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`
    }

    const rot = `rotate(${f(turn)} ${f(cx)} ${f(cy)})`
    const near = fi === 0
    const tone = ctx.ramp(near ? 0.92 : lerp(0.62, 0.3, fi / figures))
    const wBase = u(lerp(1.5, 0.5, fi / figures) * weightK)

    // Phosphor: the same path three times. The wide pass carries almost no
    // alpha and does the glowing; the thin one does the drawing.
    const trace =
      el('path', {
        d, fill: 'none', stroke: withAlpha(tone, 0.1 * glowK),
        'stroke-width': wBase * lerp(4, 16, glowK), 'stroke-linecap': 'round',
      }) +
      el('path', {
        d, fill: 'none', stroke: withAlpha(tone, 0.22 + 0.2 * glowK),
        'stroke-width': wBase * lerp(2, 5, glowK), 'stroke-linecap': 'round',
      }) +
      el('path', {
        d, fill: 'none', stroke: tone,
        'stroke-width': wBase, 'stroke-linecap': 'round',
      })

    subject.push(el('g', { transform: rot }, trace))
    // and outside the form, dimmer, so the figure is not a decal on a disc
    behind.push(el('g', { transform: rot, opacity: 0.4 }, trace))
    if (fi > 1) back.push(el('g', { transform: rot, opacity: 0.5 }, trace))

    if (near) {
      accent = el('g', { transform: rot },
        el('path', {
          d, fill: 'none', stroke: withAlpha(palette.accent, 0.5),
          'stroke-width': wBase * 5, 'stroke-linecap': 'round',
        }) +
        el('path', {
          d, fill: 'none', stroke: palette.accent,
          'stroke-width': wBase * 1.1, 'stroke-linecap': 'round',
        }))
    }
  }

  // --- the instrument ------------------------------------------------------
  // Graticule and register marks: the family is drawings of measurement, and
  // a trace with nothing to measure it against is just a squiggle.
  defs.push(el('linearGradient',
    { id: `${uid}-grid`, gradientUnits: 'objectBoundingBox', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
    el('stop', { offset: '0%', 'stop-color': withAlpha(ctx.ramp(0.5), 0) }) +
    el('stop', { offset: '45%', 'stop-color': withAlpha(ctx.ramp(0.5), 0.5) }) +
    el('stop', { offset: '100%', 'stop-color': withAlpha(ctx.ramp(0.5), 0) })))

  const ticks = 12
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2
    const r0 = reach * 1.12
    const r1 = reach * (i % 3 === 0 ? 1.3 : 1.2)
    back.push(el('path', {
      d: `M${f(cx + Math.cos(a) * r0)} ${f(cy + Math.sin(a) * r0)}` +
        `L${f(cx + Math.cos(a) * r1)} ${f(cy + Math.sin(a) * r1)}`,
      stroke: withAlpha(ctx.ramp(0.55), 0.45), 'stroke-width': u(i % 3 === 0 ? 2.2 : 1.2),
      fill: 'none', 'stroke-linecap': 'round',
    }))
  }
  back.push(el('circle', {
    cx, cy, r: reach * 1.12, fill: 'none',
    stroke: withAlpha(ctx.ramp(0.45), 0.35), 'stroke-width': u(1.2),
  }))

  // a single baseline crossing the frame, the way a plot has one
  front.push(el('path', {
    d: `M${f(cx - reach * 3)} ${f(cy + reach * 1.5)}H${f(cx + reach * 3)}`,
    stroke: `url(#${uid}-grid)`, 'stroke-width': u(1.4), fill: 'none',
  }))

  // the pen at rest, where the trace has damped out to
  behind.push(el('circle', {
    cx, cy, r: u(7),
    fill: mixHex(ctx.ramp(0.9), palette.ground, 0.2),
  }))

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
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
