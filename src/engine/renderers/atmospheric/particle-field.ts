import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Suspended particles. Thousands of small marks with a handful of large ones
 * near the focal centre, plus motion streaks that trail along the drift
 * direction — a field of equal dots reads as noise, so scale, opacity and
 * streak length all carry the depth.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'turbulence', label: 'Drift', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.66 },
  { key: 'scale', label: 'Particle size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.45 },
  { key: 'streak', label: 'Streaks', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'diamond', 'arch'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const field = ctx.rng
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const drift = ctx.num('turbulence')
  const scaleK = ctx.num('scale')
  const streakK = ctx.num('streak')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const count = Math.round(lerp(900, 3400, densityK) * Math.max(0.22, ctx.quality ** 0.7))
  const rBase = u(lerp(2.6, 9, scaleK))
  const bleed = ctx.short * 0.08

  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < count; i++) {
    if ((i & 127) === 0 && ctx.expired()) break
    const x = field.range(-bleed, w + bleed)
    const y = field.range(-bleed, h + bleed)
    if (field.next() > ctx.density(x, y)) continue
    const fall = ctx.falloff(x, y)

    // a cubed roll gives a few big particles among many small ones
    const mag = field.next() ** 3
    const r = rBase * (0.3 + 2.6 * mag) * (0.45 + 0.7 * fall)
    const tone = ctx.ramp(0.3 + 0.65 * (0.35 * mag + 0.65 * fall))
    const opacity = (0.3 + 0.55 * fall) * (0.5 + 0.5 * mag)

    let mark: string
    if (streakK > 0.03 && mag > 0.6) {
      const a = ctx.fbm(n(x) * 0.0022, n(y) * 0.0022, 3) * Math.PI * 2 + drift * 2
      const len = r * lerp(1.6, 9, streakK) * fall
      mark = el('path', {
        d: `M${f(x)} ${f(y)}L${f(x + Math.cos(a) * len)} ${f(y + Math.sin(a) * len)}`,
        stroke: tone, 'stroke-width': r * 1.1, 'stroke-linecap': 'round',
        opacity, fill: 'none',
      })
    } else {
      mark = el('circle', { cx: x, cy: y, r, fill: tone, opacity })
    }

    subject.push(mark)
    if (field.next() < 0.4) (i % 13 === 6 ? behind : back).push(mark)

    const score = Math.hypot(x - focal.cx, y - focal.cy) / Math.max(mag, 0.05)
    if (score < accentScore && mag > 0.75) {
      accentScore = score
      accent =
        el('circle', { cx: x, cy: y, r: r * 1.5, fill: palette.accent }) +
        el('circle', {
          cx: x, cy: y, r: r * 4.5, fill: 'none',
          stroke: withAlpha(palette.accent, 0.45), 'stroke-width': u(1.2),
        }) +
        el('circle', {
          cx: x + u(5) * ctx.light.dx, cy: y - u(5) * ctx.light.dy, r: r * 4.5, fill: 'none',
          stroke: withAlpha(palette.accent, 0.2), 'stroke-width': u(1),
        })
    }
  }

  // a long drift line crossing the mask edge and leaving the frame
  const ang = skel.range(0, Math.PI * 2)
  const reach = ctx.short * 1.3
  front.push(el('path', {
    d: `M${f(focal.cx - Math.cos(ang) * reach)} ${f(focal.cy - Math.sin(ang) * reach)}` +
      `L${f(focal.cx + Math.cos(ang) * reach)} ${f(focal.cy + Math.sin(ang) * reach)}`,
    stroke: withAlpha(ctx.ramp(1), 0.4), 'stroke-width': u(1.4), fill: 'none',
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const particleField: Renderer = {
  id: 'particle-field',
  name: 'Particle Field',
  family: 'atmospheric',
  dark: true,
  palettes: ['basalt', 'indigo', 'graphite', 'plum', 'verdigris', 'seafog'],
  focals: ['circle', 'ellipse', 'diamond', 'arch'],
  sampler: 'field',
  schema,
  render,
}
