import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A deep star field with a dust lane running across it. Magnitude is a cubed
 * roll, so a handful of bright stars sit among thousands of faint ones — an
 * evenly-sized field of dots reads as noise, not sky. The dust lane bleeds off
 * both edges and the brightest star carries diffraction spikes.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Star density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.65 },
  { key: 'lane', label: 'Dust lane', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.72 },
  { key: 'scale', label: 'Star size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.45 },
  { key: 'lines', label: 'Constellation', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'disc'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const field = ctx.rng
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const laneK = ctx.num('lane')
  const scaleK = ctx.num('scale')
  const linesK = ctx.num('lines')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  // the dust lane: a broad soft band of overlapping faint blobs, off both edges
  if (laneK > 0.03) {
    const angle = skel.range(-0.7, 0.7)
    const laneY = focal.cy + skel.range(-0.3, 0.3) * h
    const puffs = Math.round(lerp(40, 170, laneK) * Math.max(0.35, ctx.quality ** 0.6))
    for (let i = 0; i < puffs; i++) {
      const t = i / puffs
      const x = lerp(-w * 0.15, w * 1.15, t)
      const y = laneY + Math.tan(angle) * (x - w * 0.5) + skel.range(-1, 1) * h * 0.09 * laneK
      const fall = ctx.falloff(x, y)
      back.push(el('ellipse', {
        cx: x, cy: y,
        rx: ctx.short * skel.range(0.06, 0.2),
        ry: ctx.short * skel.range(0.02, 0.07),
        fill: ctx.ramp(0.28 + 0.3 * fall),
        opacity: 0.05 + 0.09 * fall,
        transform: `rotate(${f((angle * 180) / Math.PI)} ${f(x)} ${f(y)})`,
      }))
    }
  }

  const count = Math.round(lerp(900, 3200, densityK) * Math.max(0.22, ctx.quality ** 0.7))
  const rBase = u(lerp(1.6, 6, scaleK))
  const bright: Array<[number, number]> = []
  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < count; i++) {
    if ((i & 127) === 0 && ctx.expired()) break
    const x = field.range(-u(20), w + u(20))
    const y = field.range(-u(20), h + u(20))
    // clustering: the field is denser where the noise is high, not uniform
    const clump = 0.55 + 0.45 * ctx.fbm(n(x) * 0.0022, n(y) * 0.0022, 3)
    if (field.next() > ctx.density(x, y) * clump) continue
    const fall = ctx.falloff(x, y)
    const mag = field.next() ** 3.2
    const r = rBase * (0.22 + 3 * mag) * (0.5 + 0.6 * fall)
    const star = el('circle', {
      cx: x, cy: y, r,
      fill: ctx.ramp(0.42 + 0.58 * mag),
      opacity: (0.28 + 0.55 * fall) * (0.4 + 0.6 * mag),
    })
    subject.push(star)
    if (field.next() < 0.45) (i % 17 === 8 ? behind : back).push(star)
    if (mag > 0.55) bright.push([x, y])

    const score = Math.hypot(x - focal.cx, y - focal.cy) / Math.max(mag, 0.02)
    if (score < accentScore && mag > 0.8) {
      accentScore = score
      const spike = r * 9
      accent =
        el('circle', { cx: x, cy: y, r: r * 1.6, fill: palette.accent }) +
        el('path', {
          d: `M${f(x - spike)} ${f(y)}H${f(x + spike)}M${f(x)} ${f(y - spike)}V${f(y + spike)}`,
          stroke: withAlpha(palette.accent, 0.7), 'stroke-width': u(1.4),
          'stroke-linecap': 'round', fill: 'none',
        }) +
        el('circle', {
          cx: x, cy: y, r: r * 5, fill: 'none',
          stroke: withAlpha(palette.accent, 0.3), 'stroke-width': u(1),
        })
    }
  }

  // constellation lines between a few of the bright stars, running off frame
  if (linesK > 0.05 && bright.length > 4) {
    const hops = Math.round(lerp(3, 12, linesK))
    let prev = bright[Math.floor(skel.next() * bright.length)] as [number, number]
    for (let i = 0; i < hops; i++) {
      const next = bright[Math.floor(skel.next() * bright.length)] as [number, number]
      front.push(el('path', {
        d: `M${f(prev[0])} ${f(prev[1])}L${f(next[0])} ${f(next[1])}`,
        stroke: withAlpha(ctx.ramp(0.95), 0.16 + 0.16 * linesK),
        'stroke-width': u(1), fill: 'none',
      }))
      prev = next
    }
  }

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const starfield: Renderer = {
  id: 'starfield',
  name: 'Starfield',
  family: 'cosmic',
  dark: true,
  focals: ['circle', 'ellipse', 'disc'],
  sampler: 'field',
  schema,
  render,
}
