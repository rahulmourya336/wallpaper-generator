import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * An orrery. Ellipses at varying inclination around a common focus, each with
 * a body on it and a tick scale along its major axis. Half of each orbit is
 * emitted behind the focal form and half in front, so the bodies genuinely
 * pass around the centre rather than sitting on top of it.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Orbit count', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'inclination', label: 'Inclination', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'ticks', label: 'Tick marks', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'disc', 'circle', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette } = ctx
  const densityK = ctx.num('density')
  const incl = ctx.num('inclination')
  const ticksK = ctx.num('ticks')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const cx = focal.cx
  const cy = focal.cy
  const R = Math.max(focal.rx, focal.ry)
  const orbits = Math.round(lerp(5, 18, densityK))

  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < orbits; i++) {
    const t = (i + 1) / orbits
    const rx = R * lerp(0.55, 3.4, t) * skel.range(0.96, 1.05)
    const ry = rx * lerp(0.08, 0.92, 1 - incl * skel.range(0.4, 1))
    const rot = skel.range(-70, 70)
    const fall = ctx.falloff(cx + rx * 0.7, cy)
    const width = u(lerp(0.8, 2.6, fall) * weightK)
    const tone = ctx.ramp(0.34 + 0.5 * fall)
    const xf = `rotate(${f(rot)} ${f(cx)} ${f(cy)})`

    const half = (upper: boolean) =>
      `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 0 ${upper ? 1 : 0} ${f(cx + rx)} ${f(cy)}`

    behind.push(el('path', {
      d: half(true), fill: 'none', stroke: tone, 'stroke-width': width,
      opacity: 0.32 + 0.34 * fall, transform: xf,
    }))
    front.push(el('path', {
      d: half(false), fill: 'none', stroke: tone, 'stroke-width': width,
      opacity: 0.42 + 0.42 * fall, transform: xf,
    }))
    subject.push(el('path', {
      d: `${half(true)}${half(false)}`, fill: 'none',
      stroke: ctx.ramp(0.6 + 0.35 * fall), 'stroke-width': width * 1.1,
      opacity: 0.5 + 0.4 * fall, transform: xf,
    }))

    // tick scale along the major axis
    if (ticksK > 0.05) {
      const marks = Math.round(lerp(6, 30, ticksK))
      const parts: string[] = []
      for (let k = 0; k < marks; k++) {
        const a = (k / marks) * Math.PI * 2
        const px = cx + Math.cos(a) * rx
        const py = cy + Math.sin(a) * ry
        const long = k % 5 === 0
        parts.push(el('circle', {
          cx: px, cy: py, r: u(long ? 2.2 : 1.1),
          fill: withAlpha(ctx.ramp(0.85), long ? 0.5 : 0.24),
        }))
      }
      const scale = el('g', { transform: xf }, parts.join(''))
      back.push(scale)
      subject.push(scale)
    }

    // the body riding the orbit
    const ang = skel.range(0, Math.PI * 2)
    const bx = cx + Math.cos(ang) * rx
    const by = cy + Math.sin(ang) * ry
    const bodyR = u(lerp(3, 13, fall)) * skel.range(0.6, 1.5)
    const body = el('g', { transform: xf },
      el('circle', {
        cx: bx, cy: by, r: bodyR, fill: ctx.ramp(0.2 + 0.4 * fall),
        stroke: withAlpha(ctx.ramp(0.95), 0.5), 'stroke-width': u(1.1),
      }))
    ;(Math.sin(ang) > 0 ? front : behind).push(body)

    const score = Math.abs(rx - R * 1.4)
    if (score < accentScore) {
      accentScore = score
      accent = el('g', { transform: xf },
        el('path', {
          d: `${half(true)}${half(false)}`, fill: 'none', stroke: palette.accent,
          'stroke-width': u(2.6 * weightK), opacity: 0.9,
        }) +
        el('circle', { cx: bx, cy: by, r: bodyR * 1.15, fill: palette.accent }) +
        el('circle', {
          cx: bx + u(6), cy: by - u(4), r: bodyR * 1.15, fill: 'none',
          stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.2),
        }))
    }
  }

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const orbitalPaths: Renderer = {
  id: 'orbital-paths',
  name: 'Orbital Paths',
  family: 'cosmic',
  dark: true,
  palettes: ['basalt', 'graphite', 'indigo', 'ember', 'plum', 'chalk'],
  focals: ['disc', 'circle', 'ellipse'],
  sampler: 'field',
  schema,
  render,
}
