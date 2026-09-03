import { el, f, lerp } from '../../svg'
import { capCell } from '../../sampling'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * An isometric city. A grid sampler, so the parameters are cell size and
 * offset rather than turbulence.
 *
 * Blocks are painted back to front in depth order, which is what produces the
 * near-covers-far occlusion the pipeline asks for — with a painter's ordering
 * that comes free rather than needing a clip path. All three faces take their
 * value from the one light source, so every tower agrees.
 */

const schema: ParamSchema = [
  { key: 'cell', label: 'Block size', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.42 },
  { key: 'offset', label: 'Skyline', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'height', label: 'Height', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.5 },
  { key: 'gaps', label: 'Gaps', type: 'range', min: 0, max: 0.7, step: 0.01, default: 0.22 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'diamond', 'circle', 'arch', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const field = ctx.rng
  const { w, h, u, focal, palette, light } = ctx
  const cellK = ctx.num('cell')
  const skyline = ctx.num('offset')
  const heightK = ctx.num('height')
  const gaps = ctx.num('gaps')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  // the iso lattice packs about eight blocks into the area of one square cell
  const cell = capCell(ctx, u(lerp(190, 52, cellK)), 190)
  const hw = cell * 0.5
  const hh = cell * 0.26

  // shade the three faces from the one light source
  const towardLight = light.dx >= 0
  const topT = 0.86
  const leftT = towardLight ? 0.34 : 0.6
  const rightT = towardLight ? 0.6 : 0.34

  const originX = focal.cx
  const originY = focal.cy - ctx.short * 0.05
  const span = Math.ceil(Math.max(w, h) / cell) + 3

  type Cell = { i: number; j: number; x: number; y: number; depth: number }
  const cells: Cell[] = []
  for (let j = -span; j <= span; j++) {
    for (let i = -span; i <= span; i++) {
      const x = originX + (i - j) * hw
      const y = originY + (i + j) * hh
      if (x < -cell * 2 || x > w + cell * 2 || y < -cell * 3 || y > h + cell * 2) continue
      cells.push({ i, j, x, y, depth: i + j })
    }
  }
  cells.sort((a, b) => a.depth - b.depth)

  let accent: string | undefined
  let accentScore = Infinity

  for (const c of cells) {
    if (ctx.expired()) break
    const dens = ctx.density(c.x, c.y)
    if (field.next() > dens * (1 - gaps) * 1.35) continue
    const fall = ctx.falloff(c.x, c.y)

    const noise = ctx.fbm(c.i * 0.22, c.j * 0.22, 3) * 0.5 + 0.5
    const levels = Math.max(1, Math.round(lerp(1, 11, heightK) * lerp(0.35, 1, noise * skyline + (1 - skyline))))
    const bh = levels * hh * 1.5 * (0.5 + 0.6 * fall)

    const top = `M${f(c.x)} ${f(c.y - bh)}L${f(c.x + hw)} ${f(c.y - bh + hh)}` +
      `L${f(c.x)} ${f(c.y - bh + hh * 2)}L${f(c.x - hw)} ${f(c.y - bh + hh)}Z`
    const left = `M${f(c.x - hw)} ${f(c.y - bh + hh)}L${f(c.x)} ${f(c.y - bh + hh * 2)}` +
      `L${f(c.x)} ${f(c.y + hh * 2)}L${f(c.x - hw)} ${f(c.y + hh)}Z`
    const right = `M${f(c.x + hw)} ${f(c.y - bh + hh)}L${f(c.x)} ${f(c.y - bh + hh * 2)}` +
      `L${f(c.x)} ${f(c.y + hh * 2)}L${f(c.x + hw)} ${f(c.y + hh)}Z`

    const shade = (t: number) => ctx.ramp(0.06 + 0.8 * t * (0.4 + 0.6 * fall))
    const block =
      el('path', { d: left, fill: shade(leftT) }) +
      el('path', { d: right, fill: shade(rightT) }) +
      el('path', { d: top, fill: shade(topT) }) +
      el('path', {
        d: top, fill: 'none', stroke: withAlpha(ctx.ramp(0.98), 0.22 + 0.24 * fall),
        'stroke-width': u(1),
        transform: `translate(${f(u(2.2) * light.dx)} ${f(-u(2.2) * light.dy)})`,
      })

    subject.push(block)
    if (field.next() < 0.55) (c.depth % 11 === 5 ? behind : back).push(block)

    const score = Math.hypot(c.x - focal.cx, c.y - focal.cy) / Math.max(levels, 1)
    if (score < accentScore && levels > 3) {
      accentScore = score
      accent =
        el('path', { d: top, fill: palette.accent }) +
        el('path', { d: right, fill: withAlpha(palette.accent, 0.5) }) +
        el('path', {
          d: top, fill: 'none', stroke: withAlpha(palette.accent, 0.45), 'stroke-width': u(1.6),
          transform: `translate(${f(u(6) * light.dx)} ${f(-u(6) * light.dy)})`,
        })
    }
  }

  // a ground datum that runs off both edges
  front.push(el('path', {
    d: `M${f(-u(20))} ${f(focal.cy + focal.ry * 1.1)}H${f(w + u(20))}`,
    stroke: withAlpha(ctx.ramp(1), 0.35), 'stroke-width': u(1.8), fill: 'none',
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const isometricBlocks: Renderer = {
  id: 'isometric-blocks',
  name: 'Isometric Blocks',
  family: 'architectural',
  dark: true,
  palettes: ['basalt', 'graphite', 'indigo', 'ember', 'chalk', 'seafog'],
  focals: ['diamond', 'circle', 'arch', 'ellipse'],
  sampler: 'grid',
  schema,
  render,
}
