import { el, f, lerp, smooth } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Horizontal paths displaced by summed sines, with the amplitude peaking at
 * the focal centre so the stack builds into a single ridge. Stroke weight
 * varies across the stack and the ridge line itself gets the bright stroke —
 * an even weight reads as a graph, not a landscape.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'turbulence', label: 'Turbulence', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'ridge', label: 'Ridge', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'arch', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const turb = ctx.num('turbulence')
  const ridgeK = ctx.num('ridge')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const lines = Math.round(lerp(34, 130, densityK) * Math.max(0.45, ctx.quality ** 0.5))
  const samples = Math.max(14, Math.round(28 * Math.max(0.5, ctx.quality ** 0.5)))
  const bleed = u(30)
  const ridgeIndex = Math.round(lines * (focal.cy / h))

  // three sine terms plus fbm; phases fixed per composition, not per line
  const phase = [skel.range(0, 6.28), skel.range(0, 6.28), skel.range(0, 6.28)]
  const freq = [skel.range(1.2, 2.4), skel.range(2.6, 4.4), skel.range(5, 8)]

  let accent: string | undefined

  for (let i = 0; i < lines; i++) {
    if ((i & 15) === 0 && ctx.expired()) break
    const t = i / (lines - 1)
    const baseY = lerp(-h * 0.05, h * 1.05, t)
    const pts: number[] = []

    for (let s = 0; s <= samples; s++) {
      const x = lerp(-bleed, w + bleed, s / samples)
      const nx = n(x) * 0.001
      // amplitude peaks at the focal centre: the ridge is the field, not a shape
      const peak = ctx.falloff(x, baseY) ** 1.4
      const amp = ctx.short * (0.02 + 0.16 * ridgeK) * peak
      const wobble =
        Math.sin(nx * freq[0]! * 6.28 + phase[0]! + t * 3) * 0.5 +
        Math.sin(nx * freq[1]! * 6.28 + phase[1]! - t * 2) * 0.3 +
        Math.sin(nx * freq[2]! * 6.28 + phase[2]!) * 0.2
      const drift = ctx.fbm(nx * 2.2, t * 2.4 + 11, 3) * turb
      pts.push(x, baseY - amp * (wobble + drift * 1.3))
    }

    const d = smooth(pts, 0.5)
    const midFall = ctx.falloff(focal.cx, baseY)
    const isRidge = i === ridgeIndex
    // weight varies across the stack so it reads as strata, not a graph
    const stackWeight = 0.5 + 1.6 * Math.abs(Math.sin(i * 0.37 + 1))
    const width = u((isRidge ? 5.5 : stackWeight) * weightK * (0.45 + 0.8 * midFall))
    const tone = ctx.ramp((isRidge ? 0.95 : 0.36) + 0.5 * midFall)

    subject.push(
      el('path', { d, fill: 'none', stroke: tone, 'stroke-width': width, opacity: 0.55 + 0.45 * midFall }),
      el('path', {
        d, fill: 'none',
        stroke: withAlpha(ctx.ramp(0.9), 0.16 + 0.2 * midFall),
        'stroke-width': u(0.8),
        transform: `translate(${f(u(2.6) * ctx.light.dx)} ${f(-u(2.6) * ctx.light.dy)})`,
      }),
    )

    if (skel.next() < 0.26 + 0.44 * midFall) {
      (i % 7 === 3 ? behind : back).push(el('path', {
        d, fill: 'none',
        stroke: ctx.ramp(0.28 + 0.36 * midFall),
        'stroke-width': width * 0.7,
        opacity: 0.3 + 0.32 * midFall,
      }))
    }

    if (isRidge) {
      front.push(el('path', {
        d, fill: 'none', stroke: ctx.ramp(1), 'stroke-width': width * 0.6, opacity: 0.85,
      }))
      accent = el('path', {
        d, fill: 'none', stroke: palette.accent,
        'stroke-width': u(3 * weightK), opacity: 0.95, 'stroke-linecap': 'round',
      })
    }
  }

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const contourBands: Renderer = {
  id: 'contour-bands',
  name: 'Contour Bands',
  family: 'organic',
  dark: true,
  focals: ['circle', 'ellipse', 'arch', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
