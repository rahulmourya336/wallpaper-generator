import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Nested stair profiles spiralling into the focal centre. Each flight is a
 * stepped polyline scaled down and rotated a quarter turn from the one
 * outside it, so the whole composition reads as a single well seen from above.
 *
 * Treads take the lit value and risers the shadowed one, always on the same
 * side, which is what stops a stepped outline from reading as a bar chart.
 */

const schema: ParamSchema = [
  { key: 'cell', label: 'Step size', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.45 },
  { key: 'offset', label: 'Turn', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'flights', label: 'Flights', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'diamond', 'circle', 'arch', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette, light } = ctx
  const cellK = ctx.num('cell')
  const turn = ctx.num('offset')
  const flightsK = ctx.num('flights')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const flights = Math.round(lerp(4, 16, flightsK))
  const outer = ctx.short * 1.25
  const shadowDir = light.dx >= 0 ? 1 : -1

  let accent: string | undefined
  let accentScore = Infinity

  for (let fI = 0; fI < flights; fI++) {
    if (ctx.expired()) break
    const t = fI / flights
    const size = outer * (1 - t * 0.92) * skel.range(0.97, 1.03)
    const steps = Math.max(3, Math.round(lerp(4, 16, cellK) * (1 - t * 0.4)))
    const rise = size / steps
    const rot = (fI * 90 * turn + skel.range(-8, 8)) % 360
    const fall = ctx.falloff(focal.cx, focal.cy - size * 0.2)

    // one stepped profile, from the outside corner inward
    let d = `M${f(focal.cx - size / 2)} ${f(focal.cy + size / 2)}`
    for (let s = 0; s < steps; s++) {
      d += `h${f(rise)}v${f(-rise)}`
    }
    const tone = ctx.ramp(0.16 + 0.6 * (0.35 + 0.65 * (1 - t)) * (0.5 + 0.5 * fall))
    const xf = `rotate(${f(rot)} ${f(focal.cx)} ${f(focal.cy)})`
    const width = u(lerp(1.4, 4.5, 1 - t) * weightK)

    const flight =
      el('path', {
        d: `${d}L${f(focal.cx - size / 2)} ${f(focal.cy + size / 2)}Z`,
        fill: tone, opacity: 0.24 + 0.28 * fall, transform: xf,
      }) +
      // risers, in the shadow value
      el('path', {
        d, fill: 'none', stroke: ctx.palette.ink, 'stroke-width': width * 1.6,
        opacity: 0.4, transform: `${xf} translate(${f(shadowDir * u(5))} ${f(u(5))})`,
      }) +
      // treads, lit
      el('path', {
        d, fill: 'none', stroke: ctx.ramp(0.42 + 0.5 * fall), 'stroke-width': width,
        'stroke-linejoin': 'miter', opacity: 0.65 + 0.35 * fall, transform: xf,
      }) +
      el('path', {
        d, fill: 'none', stroke: withAlpha(ctx.ramp(0.98), 0.22 + 0.2 * fall),
        'stroke-width': u(1),
        transform: `${xf} translate(${f(u(2.4) * light.dx)} ${f(-u(2.4) * light.dy)})`,
      })

    subject.push(flight)
    ;(fI % 4 === 1 ? behind : back).push(flight)

    const score = Math.abs(size - focal.rx * 1.6)
    if (score < accentScore) {
      accentScore = score
      accent =
        el('path', {
          d, fill: 'none', stroke: palette.accent, 'stroke-width': u(3.4 * weightK),
          'stroke-linejoin': 'miter', transform: xf,
        }) +
        el('path', {
          d, fill: 'none', stroke: withAlpha(palette.accent, 0.35), 'stroke-width': u(1.2),
          transform: `${xf} translate(${f(u(7) * light.dx)} ${f(-u(7) * light.dy)})`,
        })
    }
  }

  // a handrail sweeping over the mask edge and out of frame
  const r = focal.rx * 1.35
  front.push(el('path', {
    d: `M${f(focal.cx - ctx.short)} ${f(focal.cy + r * 0.8)}` +
      `Q${f(focal.cx)} ${f(focal.cy - r * 1.1)} ${f(focal.cx + ctx.short)} ${f(focal.cy + r * 0.5)}`,
    fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.5), 'stroke-width': u(3),
    'stroke-linecap': 'round',
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const stairwells: Renderer = {
  id: 'stairwells',
  name: 'Stairwells',
  family: 'architectural',
  dark: true,
  palettes: ['basalt', 'graphite', 'plum', 'ember', 'indigo', 'chalk'],
  focals: ['diamond', 'circle', 'arch', 'ellipse'],
  sampler: 'grid',
  schema,
  render,
}
