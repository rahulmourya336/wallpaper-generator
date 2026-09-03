import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Cross-stitch on an even-weave ground. Each cell holds one or two diagonal
 * stitches with a rounded cap and a lit half, and the whole canvas keeps its
 * ground grid so the empty cells read as unworked fabric rather than as gaps.
 */

const schema: ParamSchema = [
  { key: 'cell', label: 'Stitch count', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.45 },
  { key: 'offset', label: 'Hand wobble', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'fill', label: 'Coverage', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.7 },
  { key: 'stitch', label: 'Stitch', type: 'select', options: ['cross', 'half', 'mixed'], default: 'mixed' },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'diamond', 'circle', 'arch', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const field = ctx.rng
  const { w, h, u, focal, palette, light } = ctx
  const cellK = ctx.num('cell')
  const wobbleK = ctx.num('offset')
  const coverage = ctx.num('fill')
  const kind = ctx.str('stitch')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const cell = u(lerp(78, 20, cellK))
  const cols = Math.ceil(w / cell) + 2
  const rows = Math.ceil(h / cell) + 2
  const thread = cell * 0.3

  // the unworked ground, carrying the whole frame including the quiet top
  for (let x = -cell; x < w + cell; x += cell) {
    back.push(el('path', {
      d: `M${f(x)} ${f(-u(10))}V${f(h + u(10))}`,
      stroke: ctx.ramp(0.28), 'stroke-width': u(0.7), opacity: 0.14, fill: 'none',
    }))
  }
  for (let y = -cell; y < h + cell; y += cell) {
    back.push(el('path', {
      d: `M${f(-u(10))} ${f(y)}H${f(w + u(10))}`,
      stroke: ctx.ramp(0.28), 'stroke-width': u(0.7), opacity: 0.14, fill: 'none',
    }))
  }

  let accent: string | undefined
  let accentScore = Infinity

  for (let row = -1; row < rows - 1; row++) {
    if ((row & 7) === 0 && ctx.expired()) break
    for (let col = -1; col < cols - 1; col++) {
      const cx = col * cell + cell / 2
      const cy = row * cell + cell / 2
      const d = ctx.density(cx, cy)
      if (field.next() > d * coverage * 1.3) continue
      const fall = ctx.falloff(cx, cy)

      const jx = skel.range(-1, 1) * wobbleK * cell * 0.12
      const jy = skel.range(-1, 1) * wobbleK * cell * 0.12
      const r = cell * 0.36
      const cross = kind === 'cross' || (kind === 'mixed' && field.bool(0.6))
      const tone = ctx.ramp(0.3 + 0.58 * fall)

      const leg = (s: number) =>
        `M${f(cx + jx - r * s)} ${f(cy + jy - r)}L${f(cx + jx + r * s)} ${f(cy + jy + r)}`

      const parts = [
        el('path', {
          d: leg(1), stroke: tone, 'stroke-width': thread, 'stroke-linecap': 'round',
          fill: 'none', opacity: 0.72 + 0.28 * fall,
        }),
      ]
      if (cross) {
        parts.push(el('path', {
          d: leg(-1), stroke: ctx.ramp(0.22 + 0.5 * fall), 'stroke-width': thread,
          'stroke-linecap': 'round', fill: 'none', opacity: 0.72 + 0.28 * fall,
        }))
      }
      // the lit half of the thread, offset toward the light
      parts.push(el('path', {
        d: leg(1), stroke: withAlpha(ctx.ramp(0.95), 0.16 + 0.2 * fall),
        'stroke-width': thread * 0.3, 'stroke-linecap': 'round', fill: 'none',
        transform: `translate(${f(u(1.4) * light.dx)} ${f(-u(1.4) * light.dy)})`,
      }))

      const stitch = parts.join('')
      subject.push(stitch)
      if (field.next() < 0.45) ((col + row) % 7 === 3 ? behind : back).push(stitch)

      const score = Math.hypot(cx - focal.cx, cy - focal.cy)
      if (score < accentScore) {
        accentScore = score
        accent =
          el('path', {
            d: leg(1), stroke: palette.accent, 'stroke-width': thread * 1.15,
            'stroke-linecap': 'round', fill: 'none',
          }) +
          el('path', {
            d: leg(-1), stroke: palette.accent, 'stroke-width': thread * 1.15,
            'stroke-linecap': 'round', fill: 'none',
          }) +
          el('path', {
            d: leg(1), stroke: withAlpha(palette.accent, 0.35), 'stroke-width': thread * 0.4,
            'stroke-linecap': 'round', fill: 'none',
            transform: `translate(${f(u(5))} ${f(-u(4))})`,
          })
      }
    }
  }

  // a running thread crossing the mask edge and off the frame
  const ty = focal.cy + skel.range(-0.8, 0.8) * focal.ry
  let d = `M${f(-u(20))} ${f(ty)}`
  for (let x = -cell; x < w + cell * 2; x += cell) {
    d += `q${f(cell * 0.5)} ${f(cell * (skel.bool() ? 0.5 : -0.5))} ${f(cell)} 0`
  }
  front.push(el('path', {
    d, fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.55),
    'stroke-width': thread * 0.9, 'stroke-linecap': 'round',
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const stitchGrid: Renderer = {
  id: 'stitch-grid',
  name: 'Stitch Grid',
  family: 'textile',
  dark: true,
  palettes: ['basalt', 'ember', 'plum', 'verdigris', 'graphite', 'bone', 'dune'],
  focals: ['diamond', 'circle', 'arch', 'ellipse'],
  sampler: 'grid',
  schema,
  render,
}
