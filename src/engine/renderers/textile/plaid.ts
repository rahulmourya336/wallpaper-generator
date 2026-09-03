import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A sett of vertical and horizontal bands built from one repeating stripe
 * pattern, so warp and weft agree the way a real tartan does. Crossings darken
 * because the bands overlap at partial opacity, which is what stops it reading
 * as two unrelated sets of stripes laid on top of each other.
 */

const schema: ParamSchema = [
  { key: 'cell', label: 'Sett size', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.45 },
  { key: 'offset', label: 'Sett offset', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'overcheck', label: 'Overcheck', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'variety', label: 'Stripe variety', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.6 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'diamond', 'circle', 'ellipse', 'arch'], default: 'auto' },
]

type Stripe = { width: number; tone: number; alpha: number }

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette } = ctx
  const cellK = ctx.num('cell')
  const offK = ctx.num('offset')
  const overcheck = ctx.num('overcheck')
  const variety = ctx.num('variety')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  // one sett, reused on both axes
  const settCount = 5 + Math.round(variety * 7)
  const sett: Stripe[] = Array.from({ length: settCount }, () => ({
    width: u(lerp(120, 26, cellK)) * skel.range(0.2, 1.5),
    tone: skel.range(0.1, 0.95),
    alpha: skel.range(0.3, 0.85),
  }))
  const settWidth = sett.reduce((a, s) => a + s.width, 0)
  const offset = settWidth * offK

  const bandsAlong = (total: number, start: number): Array<{ at: number; s: Stripe }> => {
    const out: Array<{ at: number; s: Stripe }> = []
    let at = start - settWidth
    while (at < total + settWidth) {
      for (const s of sett) {
        out.push({ at, s })
        at += s.width
      }
    }
    return out
  }

  const verticals = bandsAlong(w, -offset)
  const horizontals = bandsAlong(h, 0)

  for (const { at, s } of verticals) {
    const fall = ctx.falloff(at + s.width / 2, focal.cy)
    const band = el('rect', {
      x: at, y: -u(10), width: s.width, height: h + u(20),
      fill: ctx.ramp(s.tone * (0.5 + 0.5 * fall)),
      opacity: s.alpha * (0.5 + 0.5 * fall),
    })
    subject.push(band)
    back.push(band)
  }

  for (const { at, s } of horizontals) {
    const fall = ctx.falloff(focal.cx, at + s.width / 2)
    const band = el('rect', {
      x: -u(10), y: at, width: w + u(20), height: s.width,
      fill: ctx.ramp(s.tone * (0.5 + 0.5 * fall)),
      opacity: s.alpha * 0.72 * (0.5 + 0.5 * fall),
    })
    subject.push(band)
    ;(Math.abs(at - focal.cy) < focal.ry ? behind : back).push(band)
  }

  // overcheck: a wide sparse grid in the accent's neighbourhood value
  if (overcheck > 0.05) {
    const pitch = settWidth * lerp(2.4, 1.1, overcheck)
    for (let x = -pitch; x < w + pitch; x += pitch) {
      const fall = ctx.falloff(x, focal.cy)
      subject.push(el('path', {
        d: `M${f(x)} ${f(-u(10))}V${f(h + u(10))}`,
        stroke: withAlpha(ctx.ramp(0.95), 0.16 + 0.3 * fall * overcheck),
        'stroke-width': u(2.4), fill: 'none',
      }))
    }
    for (let y = -pitch; y < h + pitch; y += pitch) {
      const fall = ctx.falloff(focal.cx, y)
      subject.push(el('path', {
        d: `M${f(-u(10))} ${f(y)}H${f(w + u(10))}`,
        stroke: withAlpha(ctx.ramp(0.95), 0.16 + 0.3 * fall * overcheck),
        'stroke-width': u(2.4), fill: 'none',
      }))
    }
  }

  // the accent stripe: a single line of colour through the sett, both ways
  const ax = focal.cx + skel.range(-0.5, 0.5) * focal.rx
  const ay = focal.cy + skel.range(-0.5, 0.5) * focal.ry
  const aw = u(lerp(6, 16, cellK))
  const accent =
    el('rect', { x: ax - aw / 2, y: -u(10), width: aw, height: h + u(20), fill: palette.accent, opacity: 0.9 }) +
    el('rect', { x: -u(10), y: ay - aw / 2, width: w + u(20), height: aw, fill: palette.accent, opacity: 0.7 }) +
    el('rect', {
      x: ax - aw / 2 + u(4), y: -u(10), width: aw * 0.4, height: h + u(20),
      fill: withAlpha(palette.accent, 0.4),
    })

  // a fringe of loose threads hanging past the mask edge
  const fringeY = focal.cy + focal.ry
  for (let i = 0; i < 22; i++) {
    const fx = focal.cx - focal.rx + (i / 21) * focal.rx * 2
    front.push(el('path', {
      d: `M${f(fx)} ${f(fringeY - u(10))}V${f(fringeY + u(skel.range(20, 90)))}`,
      stroke: withAlpha(ctx.ramp(0.9), 0.3), 'stroke-width': u(1.6), fill: 'none',
    }))
  }

  return { back, behind, subject, front, accent }
}

export const plaid: Renderer = {
  id: 'plaid',
  name: 'Plaid',
  family: 'textile',
  dark: true,
  focals: ['diamond', 'circle', 'ellipse', 'arch'],
  sampler: 'grid',
  schema,
  render,
}
