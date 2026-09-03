import { el, f, lerp } from '../../svg'
import { capCell } from '../../sampling'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A grid sampler, not a field sampler: the parameters are thread pitch and
 * slub rather than turbulence.
 *
 * The interlacing is done in three passes — every warp thread full height,
 * every weft thread full width, then the over-thread redrawn per cell on top.
 * Drawing each cell as a self-contained pair of rectangles instead produces a
 * checkerboard of blocks: the threads have to be continuous for the eye to
 * read them as passing under one another.
 */

const schema: ParamSchema = [
  { key: 'cell', label: 'Thread pitch', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.45 },
  { key: 'offset', label: 'Slub', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'gap', label: 'Thread gap', type: 'range', min: 0.05, max: 0.6, step: 0.01, default: 0.34 },
  { key: 'weave', label: 'Weave', type: 'select', options: ['plain', 'twill', 'basket'], default: 'plain' },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'diamond', 'ellipse', 'arch'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette, light } = ctx
  const cellK = ctx.num('cell')
  const slub = ctx.num('offset')
  const gapK = ctx.num('gap')
  const weave = ctx.str('weave')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const cell = capCell(ctx, u(lerp(84, 24, cellK)), 1300)
  const thread = cell * (1 - gapK)
  const cols = Math.ceil(w / cell) + 2
  const rows = Math.ceil(h / cell) + 2

  const over = (col: number, row: number): boolean => {
    if (weave === 'twill') return (col + row * 2) % 3 !== 0
    if (weave === 'basket') return (Math.floor(col / 2) + Math.floor(row / 2)) % 2 === 0
    return (col + row) % 2 === 0
  }

  // per-thread slub, fixed once so a thread keeps its thickness down its length
  const warpW = Array.from({ length: cols + 2 }, () =>
    Math.max(u(1), thread * (1 + skel.range(-1, 1) * slub * 0.28)))
  const weftW = Array.from({ length: rows + 2 }, () =>
    Math.max(u(1), thread * (1 + skel.range(-1, 1) * slub * 0.28)))

  const warpX = (col: number) => col * cell + cell / 2
  const weftY = (row: number) => row * cell + cell / 2

  // pass 1: warp, full height
  for (let col = -1; col < cols - 1; col++) {
    const x = warpX(col)
    const tw = warpW[col + 1] as number
    const fall = ctx.falloff(x, focal.cy)
    const bar = el('rect', {
      x: x - tw / 2, y: -u(10), width: tw, height: h + u(20),
      fill: ctx.ramp(0.22 + 0.48 * fall), opacity: 0.75 + 0.25 * fall,
    })
    subject.push(bar)
    back.push(bar)
  }

  // pass 2: weft, full width
  for (let row = -1; row < rows - 1; row++) {
    const y = weftY(row)
    const tw = weftW[row + 1] as number
    const fall = ctx.falloff(focal.cx, y)
    const bar = el('rect', {
      x: -u(10), y: y - tw / 2, width: w + u(20), height: tw,
      fill: ctx.ramp(0.36 + 0.52 * fall), opacity: 0.75 + 0.25 * fall,
    })
    subject.push(bar)
    ;(Math.abs(y - focal.cy) < focal.ry ? behind : back).push(bar)
  }

  // pass 3: whichever thread passes over, redrawn across this cell only
  let accent: string | undefined
  let accentScore = Infinity

  for (let row = -1; row < rows - 1; row++) {
    if ((row & 7) === 0 && ctx.expired()) break
    for (let col = -1; col < cols - 1; col++) {
      const x = warpX(col)
      const y = weftY(row)
      const fall = ctx.falloff(x, y)
      const ww = warpW[col + 1] as number
      const fw = weftW[row + 1] as number
      const isOver = over(col, row)

      const seg = isOver
        ? el('rect', {
            x: x - ww / 2, y: y - cell / 2, width: ww, height: cell,
            fill: ctx.ramp(0.24 + 0.5 * fall), opacity: 0.9,
          })
        : el('rect', {
            x: x - cell / 2, y: y - fw / 2, width: cell, height: fw,
            fill: ctx.ramp(0.38 + 0.54 * fall), opacity: 0.9,
          })
      // the lit edge on whichever thread is on top
      const sheen = isOver
        ? el('rect', {
            x: x - ww / 2, y: y - cell / 2, width: ww * 0.3, height: cell,
            fill: withAlpha(ctx.ramp(0.98), 0.14 + 0.2 * fall),
            transform: `translate(${f(u(1.4) * light.dx)} ${f(-u(1.4) * light.dy)})`,
          })
        : el('rect', {
            x: x - cell / 2, y: y - fw / 2, width: cell, height: fw * 0.3,
            fill: withAlpha(ctx.ramp(0.98), 0.14 + 0.2 * fall),
            transform: `translate(${f(u(1.4) * light.dx)} ${f(-u(1.4) * light.dy)})`,
          })

      subject.push(seg, sheen)
      if (skel.next() < 0.45) back.push(seg)

      const score = Math.hypot(x - focal.cx, y - focal.cy)
      if (score < accentScore) {
        accentScore = score
        accent =
          el('rect', { x: x - ww / 2, y: -u(10), width: ww, height: h + u(20), fill: palette.accent, opacity: 0.9 }) +
          el('rect', {
            x: -u(10), y: y - fw / 2, width: w + u(20), height: fw,
            fill: withAlpha(palette.accent, 0.55),
          })
      }
    }
  }

  // a selvedge cord running the full width, crossing over the mask
  const selY = focal.cy + skel.range(-0.9, 0.9) * focal.ry
  front.push(el('path', {
    d: `M${f(-u(20))} ${f(selY)}H${f(w + u(20))}`,
    stroke: withAlpha(ctx.ramp(1), 0.5), 'stroke-width': cell * 0.36, fill: 'none',
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const plainWeave: Renderer = {
  id: 'plain-weave',
  name: 'Plain Weave',
  family: 'textile',
  dark: true,
  focals: ['circle', 'diamond', 'ellipse', 'arch'],
  sampler: 'grid',
  schema,
  render,
}
