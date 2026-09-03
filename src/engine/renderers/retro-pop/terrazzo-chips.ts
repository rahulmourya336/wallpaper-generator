import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import { blob, packCircles } from '../../sampling'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Terrazzo: hundreds of irregular chips packed by rejection sampling, with
 * chip size and count driven by the density field so the aggregate is fine and
 * crowded inside the focal form and coarse and sparse outside it.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.66 },
  { key: 'chip', label: 'Chip size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'variety', label: 'Variety', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'outline', label: 'Outline', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'arch', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette, light } = ctx
  const densityK = ctx.num('density')
  const chipK = ctx.num('chip')
  const variety = ctx.num('variety')
  const outlineK = ctx.num('outline')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const rMax = u(lerp(14, 48, chipK))
  const chips = packCircles(ctx, {
    target: Math.round(lerp(320, 1100, densityK) * Math.max(0.3, ctx.quality ** 0.6)),
    rMin: rMax * 0.2,
    rMax,
    padding: u(1.6),
  })

  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < chips.length; i++) {
    const c = chips[i] as (typeof chips)[number]
    const fall = ctx.falloff(c.x, c.y)
    const sides = 4 + Math.floor(skel.next() * (3 + variety * 4))
    const d = blob(c.x, c.y, c.r, sides, skel, 0.18 + 0.4 * variety)
    // chips step through the ramp rather than sitting on one value
    const step = Math.floor(skel.next() * 4) / 3
    const tone = ctx.ramp(0.26 + 0.66 * step * (0.55 + 0.45 * fall))

    const chip =
      el('path', { d, fill: tone, opacity: 0.85 + 0.15 * fall }) +
      (outlineK > 0.03
        ? el('path', {
            d, fill: 'none',
            stroke: withAlpha(ctx.ramp(0.95), 0.1 + 0.35 * outlineK * fall),
            'stroke-width': u(0.9),
            transform: `translate(${f(u(2) * light.dx)} ${f(-u(2) * light.dy)})`,
          })
        : '')

    subject.push(chip)
    if (skel.next() < 0.55) (i % 11 === 5 ? behind : back).push(chip)

    const score = Math.hypot(c.x - focal.cx, c.y - focal.cy) / Math.max(c.r, 1)
    if (score < accentScore && c.r > rMax * 0.55) {
      accentScore = score
      accent =
        el('path', { d, fill: palette.accent }) +
        el('path', {
          d, fill: 'none', stroke: withAlpha(palette.accent, 0.45), 'stroke-width': u(1.4),
          transform: `translate(${f(u(6) * light.dx)} ${f(-u(6) * light.dy)})`,
        })
    }
  }

  // one oversized chip breaking the mask edge and running off the frame
  const bigR = rMax * 3.4
  const ang = skel.range(0, Math.PI * 2)
  front.push(el('path', {
    d: blob(focal.cx + Math.cos(ang) * focal.rx, focal.cy + Math.sin(ang) * focal.ry, bigR, 7, skel, 0.3),
    fill: ctx.ramp(0.42),
    stroke: withAlpha(ctx.ramp(1), 0.5),
    'stroke-width': u(2),
    opacity: 0.9,
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const terrazzoChips: Renderer = {
  id: 'terrazzo-chips',
  name: 'Terrazzo Chips',
  family: 'retro-pop',
  dark: false,
  focals: ['circle', 'ellipse', 'arch', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
