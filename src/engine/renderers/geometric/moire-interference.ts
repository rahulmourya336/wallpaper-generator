import { circlePath, el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Two dense sets of concentric circles on offset centres. The interference
 * pattern is the whole image, so it lives or dies on the ratio between ring
 * spacing and stroke weight: too heavy and the rings merge into mud before the
 * moiré ever forms, too light and they vanish below a device pixel. Both are
 * expressed in design units, which keeps the ring count — and therefore the
 * pattern itself — identical from thumbnail to 4x export.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.66 },
  { key: 'offset', label: 'Separation', type: 'range', min: 0.02, max: 0.5, step: 0.005, default: 0.16 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.5, max: 2.2, step: 0.01, default: 1.05 },
  { key: 'third', label: 'Third set', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette } = ctx
  const densityK = ctx.num('density')
  const sep = ctx.num('offset')
  const weightK = ctx.num('weight')
  const thirdK = ctx.num('third')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const reach = Math.hypot(w, h) * 0.78
  // Spacing is in design units, so the ring COUNT is resolution independent
  // and the interference pattern survives the 4x export unchanged.
  const spacing = u(lerp(15, 5, densityK))

  const centres: Array<{ x: number; y: number; tone: number; op: number }> = [
    { x: focal.cx, y: focal.cy, tone: 0.86, op: 1 },
    {
      x: focal.cx + Math.cos(skel.range(0, Math.PI * 2)) * ctx.short * sep,
      y: focal.cy + Math.sin(skel.range(0, Math.PI * 2)) * ctx.short * sep,
      tone: 0.66, op: 0.8,
    },
  ]
  if (thirdK > 0.05) {
    centres.push({
      x: focal.cx + skel.range(-1, 1) * ctx.short * sep * 2.2,
      y: focal.cy + skel.range(-1, 1) * ctx.short * sep * 2.2,
      tone: 0.5, op: 0.35 + 0.4 * thirdK,
    })
  }

  let accent: string | undefined

  centres.forEach((c, ci) => {
    const rings = Math.floor(reach / spacing)
    for (let i = 1; i <= rings; i++) {
      if ((i & 31) === 0 && ctx.expired()) break
      const r = i * spacing
      // Sample the field at the ring's closest approach to the focal centre.
      // Projecting a probe point along c -> focal collapses to the centre
      // itself for the primary set, which hands every ring fall = 1 and
      // flattens the whole composition.
      const near = Math.abs(r - Math.hypot(c.x - focal.cx, c.y - focal.cy))
      const fall = ctx.falloff(focal.cx + near, focal.cy)
      const d = circlePath(c.x, c.y, r)
      const width = u(weightK * (0.55 + 0.75 * fall))

      subject.push(el('path', {
        d, fill: 'none',
        stroke: ctx.ramp(c.tone * (0.62 + 0.38 * fall)),
        'stroke-width': width,
        opacity: c.op * (0.72 + 0.28 * fall),
      }))
      if (skel.next() < 0.55 + 0.35 * fall) {
        back.push(el('path', {
          d, fill: 'none',
          stroke: ctx.ramp(c.tone * 0.72),
          'stroke-width': width * 0.85,
          opacity: c.op * (0.4 + 0.32 * fall),
        }))
      }
      // one lit ring, on the primary set, close to the focal radius
      if (ci === 0 && !accent && r > focal.rx * 0.92) {
        accent =
          el('path', {
            d, fill: 'none', stroke: palette.accent,
            'stroke-width': u(2.4), opacity: 0.95,
          }) +
          el('path', {
            d: circlePath(c.x, c.y, r + u(4)), fill: 'none',
            stroke: withAlpha(palette.accent, 0.35), 'stroke-width': u(1),
          })
      }
    }
  })

  // a hairline sweep across the whole frame, and the near centre marked in front
  const a = skel.range(0, Math.PI)
  behind.push(el('path', {
    d: `M${f(focal.cx - Math.cos(a) * reach)} ${f(focal.cy - Math.sin(a) * reach)}` +
      `L${f(focal.cx + Math.cos(a) * reach)} ${f(focal.cy + Math.sin(a) * reach)}`,
    stroke: withAlpha(ctx.ramp(0.9), 0.3), 'stroke-width': u(1.6), fill: 'none',
  }))
  const c1 = centres[1] as { x: number; y: number }
  front.push(el('path', {
    d: circlePath(c1.x, c1.y, u(14)),
    fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.7), 'stroke-width': u(2),
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const moireInterference: Renderer = {
  id: 'moire-interference',
  name: 'Moiré Interference',
  family: 'geometric',
  dark: true,
  palettes: ['basalt', 'graphite', 'indigo', 'plum', 'verdigris', 'chalk', 'bone'],
  focals: ['circle', 'ellipse', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
