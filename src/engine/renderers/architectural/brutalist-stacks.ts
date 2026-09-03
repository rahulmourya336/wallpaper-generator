import { el, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Cantilevered concrete slabs stacked into towers. A grid sampler on the
 * horizontal axis only: towers sit on a fixed pitch and every slab steps left
 * or right of the one below it, so the silhouette is built by the stack rather
 * than drawn.
 *
 * Slabs cast a hard shadow on the tower behind them, always in the one light
 * direction, and the outermost towers run past both edges.
 */

const schema: ParamSchema = [
  { key: 'cell', label: 'Tower pitch', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.45 },
  { key: 'offset', label: 'Cantilever', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'height', label: 'Height', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.55 },
  { key: 'slots', label: 'Slot windows', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'arch', 'circle', 'diamond', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette, light } = ctx
  const cellK = ctx.num('cell')
  const cantilever = ctx.num('offset')
  const heightK = ctx.num('height')
  const slotsK = ctx.num('slots')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const pitch = w / Math.max(2, Math.round(lerp(3, 9, cellK)))
  const towers = Math.ceil(w / pitch) + 2
  const baseY = ctx.baseline + u(20)
  const shadowDir = light.dx >= 0 ? 1 : -1

  let accent: string | undefined
  let accentScore = Infinity

  for (let i = -1; i < towers; i++) {
    if (ctx.expired()) break
    const cx = i * pitch + pitch * 0.5
    const fall = ctx.falloff(cx, ctx.baseline * 0.75)
    const slabs = Math.max(3, Math.round(lerp(5, 18, heightK) * (0.5 + 0.7 * fall)))
    // Distribute a target height across the stack rather than summing fixed
    // slab heights: otherwise the towers land wherever the arithmetic happens
    // to end and the composition reads as a strip along the bottom edge.
    const targetH = h * lerp(0.4, 1.05, heightK) * (0.45 + 0.75 * fall)
    let y = baseY
    let anchor = cx

    const parts: string[] = []
    for (let k = 0; k < slabs; k++) {
      const t = k / slabs
      const sh = (targetH / slabs) * lerp(1.5, 0.55, t) * skel.range(0.75, 1.25)
      const sw = pitch * lerp(1.05, 0.5, t) * skel.range(0.8, 1.15)
      anchor += skel.range(-1, 1) * pitch * 0.34 * cantilever
      const x = anchor - sw / 2
      const top = y - sh
      const slabFall = ctx.falloff(anchor, top)
      const tone = ctx.ramp(0.12 + 0.5 * slabFall * (0.5 + 0.5 * (1 - t)))

      // cast shadow, on the same side for every slab in the composition
      parts.push(el('rect', {
        x: x + shadowDir * u(7), y: top + u(7), width: sw, height: sh,
        fill: ctx.palette.ink, opacity: 0.42,
      }))
      parts.push(el('rect', { x, y: top, width: sw, height: sh, fill: tone }))
      // lit top edge
      parts.push(el('rect', {
        x, y: top, width: sw, height: Math.max(u(1.5), sh * 0.07),
        fill: withAlpha(ctx.ramp(0.98), 0.3 + 0.25 * slabFall),
      }))
      // slot windows: the detail that gives the slab scale
      if (slotsK > 0.05 && sh > u(22)) {
        const slots = Math.max(1, Math.round((sw / u(30)) * slotsK))
        for (let s = 0; s < slots; s++) {
          const sx = x + ((s + 0.5) / slots) * sw - u(3)
          parts.push(el('rect', {
            x: sx, y: top + sh * 0.28, width: u(6), height: sh * 0.44,
            fill: withAlpha(ctx.palette.ink, 0.55),
          }))
        }
      }

      const score = Math.hypot(anchor - focal.cx, top - focal.cy)
      if (score < accentScore && sh > pitch * 0.18) {
        accentScore = score
        accent =
          el('rect', { x, y: top, width: sw, height: sh, fill: palette.accent }) +
          el('rect', {
            x: x + u(8) * light.dx, y: top - u(8) * light.dy, width: sw, height: sh,
            fill: 'none', stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.6),
          })
      }
      y = top
    }

    const tower = parts.join('')
    // nearer towers overlap farther ones; the middle one passes behind the form
    if (i % 3 === 1) behind.push(tower)
    else back.push(tower)
    subject.push(tower)
  }

  // one slab pushed right to the front, crossing the mask edge and the frame
  const fy = focal.cy + skel.range(-0.4, 0.5) * focal.ry
  const fw = pitch * 1.9
  front.push(
    el('rect', {
      x: focal.cx - fw / 2 + shadowDir * u(9), y: fy + u(9),
      width: fw, height: pitch * 0.3, fill: ctx.palette.ink, opacity: 0.45,
    }) +
    el('rect', {
      x: focal.cx - fw / 2, y: fy, width: fw, height: pitch * 0.3,
      fill: ctx.ramp(0.5),
    }) +
    el('rect', {
      x: focal.cx - fw / 2, y: fy, width: fw, height: u(3),
      fill: withAlpha(ctx.ramp(1), 0.55),
    }),
  )

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const brutalistStacks: Renderer = {
  id: 'brutalist-stacks',
  name: 'Brutalist Stacks',
  family: 'architectural',
  dark: true,
  focals: ['arch', 'circle', 'diamond', 'ellipse'],
  sampler: 'grid',
  schema,
  render,
}
