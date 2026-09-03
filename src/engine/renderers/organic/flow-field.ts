import { el, f, lerp, smooth } from '../../svg'
import { withAlpha } from '../../palette'
import { streamline } from '../../sampling'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Streamlines integrated through the noise field. Seeds are rejection-sampled
 * against the density field, and both the length and the weight of a line
 * decay with distance from the focal centre, so the field thins out rather
 * than stopping at an edge.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'turbulence', label: 'Turbulence', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'flow', label: 'Line length', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.5 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'arch', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const field = ctx.rng
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const turb = ctx.num('turbulence')
  const flowK = ctx.num('flow')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const scale = lerp(0.0006, 0.0021, turb)
  const swirl = skel.range(-0.5, 0.5)
  const bias = skel.range(0, Math.PI * 2)
  const angleAt = (x: number, y: number) => {
    const v = ctx.fbm(n(x) * scale, n(y) * scale, 4)
    const spin = Math.atan2(y - focal.cy, x - focal.cx) + Math.PI * 0.5
    // The vortex term has to stay small: coupled any harder to the radial
    // angle it drags every streamline into a single knot at the focal centre.
    return bias + v * Math.PI * 1.6 + spin * swirl * 0.16
  }

  const count = Math.round(lerp(260, 820, densityK) * Math.max(0.3, ctx.quality ** 0.6))
  const step = ctx.short * 0.012
  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < count; i++) {
    if ((i & 31) === 0 && ctx.expired()) break
    const x = field.range(-ctx.short * 0.1, w + ctx.short * 0.1)
    const y = field.range(-ctx.short * 0.1, h + ctx.short * 0.1)
    const d = ctx.density(x, y)
    if (field.next() > d) continue
    const fall = ctx.falloff(x, y)

    const steps = Math.max(4, Math.round(lerp(8, 46, flowK) * (0.3 + 0.7 * fall)))
    const pts = streamline(ctx, { x, y }, angleAt, steps, step)
    if (pts.length < 8) continue
    const path = smooth(pts, 0.5)

    const width = u(lerp(0.5, 2.6, fall * fall) * weightK)
    const tone = ctx.ramp(0.3 + 0.62 * fall)
    const line = el('path', {
      d: path, fill: 'none', stroke: tone, 'stroke-width': width,
      opacity: 0.34 + 0.56 * fall, 'stroke-linecap': 'round',
    })

    subject.push(line)
    if (field.next() < 0.3 + 0.35 * fall) (i % 9 === 4 ? behind : back).push(line)

    const score = Math.hypot(x - focal.cx, y - focal.cy)
    if (score < accentScore && steps > 20) {
      accentScore = score
      accent =
        el('path', {
          d: path, fill: 'none', stroke: palette.accent,
          'stroke-width': u(3.4 * weightK), 'stroke-linecap': 'round', opacity: 0.95,
        }) +
        el('path', {
          d: path, fill: 'none', stroke: withAlpha(palette.accent, 0.35),
          'stroke-width': u(1.2),
          transform: `translate(${f(u(5) * ctx.light.dx)} ${f(-u(5) * ctx.light.dy)})`,
        })
    }
  }

  // a single long line riding over the mask edge and off the frame
  const rider = streamline(
    ctx,
    { x: focal.cx + skel.range(-1, 1) * focal.rx, y: focal.cy + skel.range(-1, 1) * focal.ry },
    angleAt, 160, step * 1.6,
  )
  if (rider.length > 8) {
    front.push(el('path', {
      d: smooth(rider, 0.5), fill: 'none',
      stroke: withAlpha(ctx.ramp(1), 0.75), 'stroke-width': u(2.4 * weightK),
      'stroke-linecap': 'round',
    }))
  }

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const flowField: Renderer = {
  id: 'flow-field',
  name: 'Flow Field',
  family: 'organic',
  dark: true,
  palettes: ['basalt', 'indigo', 'verdigris', 'plum', 'graphite', 'seafog', 'bone'],
  focals: ['circle', 'ellipse', 'arch', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
