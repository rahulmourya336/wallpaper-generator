import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Wide ribbons sweeping edge to edge, each a filled band between two offset
 * bezier spines. Every ribbon enters and leaves the frame, so none of them
 * reads as a floating shape, and each carries a misregistered outline in the
 * light direction — the screen-print miss that keeps flat fills from looking
 * like CSS.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'turbulence', label: 'Sweep', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'ribbon', label: 'Ribbon width', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'hatch', label: 'Hatching', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'diamond', 'arch'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette, light } = ctx
  const densityK = ctx.num('density')
  const sweep = ctx.num('turbulence')
  const ribbonK = ctx.num('ribbon')
  const hatchK = ctx.num('hatch')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const count = Math.round(lerp(7, 24, densityK))
  const over = ctx.short * 0.2
  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count
    const y0 = lerp(-h * 0.1, h * 1.1, t) + skel.range(-1, 1) * h * 0.03
    const fall = ctx.falloff(focal.cx, y0)
    const band = ctx.short * lerp(0.03, 0.16, ribbonK) * (0.4 + 0.75 * fall)

    const c1y = y0 + skel.range(-1, 1) * h * 0.22 * sweep
    const c2y = y0 + skel.range(-1, 1) * h * 0.22 * sweep
    const y1 = y0 + skel.range(-1, 1) * h * 0.1 * sweep

    const spine = (o: number) =>
      `M${f(-over)} ${f(y0 + o)}C${f(w * 0.33)} ${f(c1y + o)},${f(w * 0.67)} ${f(c2y + o)},${f(w + over)} ${f(y1 + o)}`
    const d = `${spine(-band / 2)}L${f(w + over)} ${f(y1 + band / 2)}` +
      `C${f(w * 0.67)} ${f(c2y + band / 2)},${f(w * 0.33)} ${f(c1y + band / 2)},${f(-over)} ${f(y0 + band / 2)}Z`

    const tone = ctx.ramp(0.16 + 0.62 * fall)
    const parts: string[] = [
      el('path', { d, fill: tone, opacity: 0.82 + 0.18 * fall }),
      el('path', {
        d, fill: 'none',
        stroke: withAlpha(ctx.ramp(0.95), 0.28 + 0.34 * fall),
        'stroke-width': u(1.4),
        transform: `translate(${f(u(4) * light.dx)} ${f(-u(4) * light.dy)})`,
      }),
    ]

    // hatching inside the wider ribbons, so the fills are surfaces not slabs
    if (hatchK > 0.05 && band > ctx.short * 0.05) {
      const lines = Math.round(lerp(3, 11, hatchK))
      for (let k = 1; k < lines; k++) {
        parts.push(el('path', {
          d: spine(-band / 2 + (band * k) / lines),
          fill: 'none',
          stroke: withAlpha(ctx.ramp(0.9), 0.06 + 0.12 * fall),
          'stroke-width': u(0.9),
        }))
      }
    }

    const ribbon = parts.join('')
    subject.push(ribbon)
    ;(i % 5 === 2 ? behind : back).push(ribbon)

    const score = Math.abs(y0 - focal.cy)
    if (score < accentScore) {
      accentScore = score
      accent =
        el('path', { d, fill: palette.accent, opacity: 0.95 }) +
        el('path', {
          d, fill: 'none', stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.6),
          transform: `translate(${f(u(9) * light.dx)} ${f(-u(9) * light.dy)})`,
        })
    }

    if (i === Math.floor(count * 0.72)) {
      front.push(el('path', {
        d, fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.65), 'stroke-width': u(2.6),
      }))
    }
  }

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const ribbonBands: Renderer = {
  id: 'ribbon-bands',
  name: 'Ribbon Bands',
  family: 'retro-pop',
  dark: true,
  focals: ['circle', 'ellipse', 'diamond', 'arch'],
  sampler: 'field',
  schema,
  render,
}
