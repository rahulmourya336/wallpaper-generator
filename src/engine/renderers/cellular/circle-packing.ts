import { circlePath, el, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import { packCircles } from '../../sampling'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Apollonian-ish packing by rejection sampling. Attempts are capped and the
 * wall clock is polled inside the packer: an uncapped packing loop will freeze
 * the slider, and bailing out with fewer circles is always better than a stall.
 *
 * Each disc carries two or three concentric rings, which is where the element
 * count comes from and what keeps the field from reading as flat dots.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.68 },
  { key: 'scale', label: 'Cell size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'rings', label: 'Inner rings', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'arch', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette, light } = ctx
  const densityK = ctx.num('density')
  const scaleK = ctx.num('scale')
  const ringsK = ctx.num('rings')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const rMax = u(lerp(28, 105, scaleK))
  const circles = packCircles(ctx, {
    target: Math.round(lerp(180, 460, densityK) * Math.max(0.3, ctx.quality ** 0.6)),
    rMin: rMax * 0.11,
    rMax,
    padding: u(2),
  })

  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < circles.length; i++) {
    const c = circles[i] as (typeof circles)[number]
    const fall = ctx.falloff(c.x, c.y)
    const width = u(lerp(0.9, 3.2, fall) * weightK)
    const tone = ctx.ramp(0.32 + 0.58 * fall)

    const parts: string[] = [
      el('circle', {
        cx: c.x, cy: c.y, r: c.r, fill: ctx.ramp(0.1 + 0.2 * fall),
        stroke: tone, 'stroke-width': width, opacity: 0.62 + 0.38 * fall,
      }),
    ]
    const inner = Math.round(lerp(0, 4, ringsK) * (0.4 + 0.7 * fall))
    for (let k = 1; k <= inner; k++) {
      parts.push(el('circle', {
        cx: c.x, cy: c.y, r: c.r * (1 - k / (inner + 1.2)),
        fill: 'none', stroke: tone, 'stroke-width': width * 0.6,
        opacity: 0.3 + 0.35 * fall,
      }))
    }
    // misregistration: the outline that missed its fill
    parts.push(el('circle', {
      cx: c.x + u(2.4) * light.dx, cy: c.y - u(2.4) * light.dy, r: c.r,
      fill: 'none', stroke: withAlpha(ctx.ramp(0.95), 0.16 + 0.2 * fall),
      'stroke-width': u(0.9),
    }))

    const cell = parts.join('')
    subject.push(cell)
    if (skel.next() < 0.55) (i % 11 === 5 ? behind : back).push(cell)

    const score = Math.hypot(c.x - focal.cx, c.y - focal.cy) / Math.max(c.r, 1)
    if (score < accentScore && c.r > rMax * 0.4) {
      accentScore = score
      accent =
        el('circle', { cx: c.x, cy: c.y, r: c.r, fill: palette.accent }) +
        el('circle', {
          cx: c.x, cy: c.y, r: c.r * 0.6, fill: 'none',
          stroke: withAlpha(ctx.palette.ground, 0.6), 'stroke-width': u(2),
        }) +
        el('circle', {
          cx: c.x + u(7) * light.dx, cy: c.y - u(7) * light.dy, r: c.r,
          fill: 'none', stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.4),
        })
    }
  }

  // one oversized cell straddling the mask edge and running off the frame
  const ang = skel.range(0, Math.PI * 2)
  const bigR = rMax * 2.6
  front.push(el('path', {
    d: circlePath(focal.cx + Math.cos(ang) * focal.rx, focal.cy + Math.sin(ang) * focal.ry, bigR),
    fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.55), 'stroke-width': u(2.8 * weightK),
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const circlePacking: Renderer = {
  id: 'circle-packing',
  name: 'Circle Packing',
  family: 'cellular',
  dark: true,
  palettes: ['basalt', 'verdigris', 'graphite', 'ember', 'indigo', 'bone', 'chalk'],
  focals: ['circle', 'ellipse', 'arch', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
