import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Orthogonal and 45-degree traces routed on a grid, with vias where they turn
 * and pads where they terminate. Traces start off-canvas and most of them
 * leave it again, so the board always continues past the frame.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'pitch', label: 'Grid pitch', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'diagonal', label: 'Diagonals', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'weight', label: 'Trace weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'diamond', 'ellipse', 'arch'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const field = ctx.rng
  const { w, h, u, focal, palette } = ctx
  const densityK = ctx.num('density')
  const pitchK = ctx.num('pitch')
  const diagK = ctx.num('diagonal')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const pitch = u(lerp(60, 18, pitchK))
  const traces = Math.round(lerp(60, 260, densityK) * Math.max(0.4, ctx.quality ** 0.6))
  const snap = (v: number) => Math.round(v / pitch) * pitch

  // the substrate grid, quiet, carrying the whole frame including the top
  for (let x = 0; x < w + pitch; x += pitch * 2) {
    back.push(el('path', {
      d: `M${f(x)} ${f(-u(10))}V${f(h + u(10))}`,
      stroke: ctx.ramp(0.3), 'stroke-width': u(0.6), opacity: 0.12, fill: 'none',
    }))
  }
  for (let y = 0; y < h + pitch; y += pitch * 2) {
    back.push(el('path', {
      d: `M${f(-u(10))} ${f(y)}H${f(w + u(10))}`,
      stroke: ctx.ramp(0.3), 'stroke-width': u(0.6), opacity: 0.12, fill: 'none',
    }))
  }

  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < traces; i++) {
    if ((i & 15) === 0 && ctx.expired()) break
    let x = snap(field.range(-pitch * 2, w + pitch * 2))
    let y = snap(field.range(-pitch * 2, h + pitch * 2))
    if (field.next() > ctx.density(x, y)) continue

    const fall = ctx.falloff(x, y)
    const legs = Math.max(2, Math.round(lerp(2, 11, densityK) * (0.4 + 0.8 * fall)))
    let d = `M${f(x)} ${f(y)}`
    const vias: Array<[number, number]> = []
    let dir = field.int(0, 3)

    for (let k = 0; k < legs; k++) {
      const run = pitch * field.int(1, 4)
      const diagonal = field.next() < diagK * 0.45
      const dx = dir === 0 ? run : dir === 2 ? -run : 0
      const dy = dir === 1 ? run : dir === 3 ? -run : 0
      if (diagonal) {
        // 45-degree dogleg, the detail that says "routed" rather than "grid"
        const bend = run * 0.45
        const sx = x + Math.sign(dx || 1) * bend * (dx ? 1 : 0)
        const sy = y + Math.sign(dy || 1) * bend * (dy ? 1 : 0)
        d += `L${f(sx)} ${f(sy)}L${f(sx + bend * 0.7)} ${f(sy + bend * 0.7 * (field.bool() ? 1 : -1))}`
        x = sx + bend * 0.7
        y = sy
      }
      x += dx
      y += dy
      d += `L${f(x)} ${f(y)}`
      vias.push([x, y])
      dir = (dir + (field.bool() ? 1 : 3)) % 4
    }

    const width = u(lerp(0.9, 3.2, fall) * weightK)
    const tone = ctx.ramp(0.34 + 0.58 * fall)
    const parts: string[] = [
      el('path', {
        d, fill: 'none', stroke: tone, 'stroke-width': width,
        'stroke-linecap': 'square', 'stroke-linejoin': 'round',
        opacity: 0.5 + 0.5 * fall,
      }),
    ]
    for (const [vx, vy] of vias) {
      if (field.next() > 0.34) continue
      parts.push(el('circle', {
        cx: vx, cy: vy, r: width * 1.9, fill: ctx.palette.ground,
        stroke: tone, 'stroke-width': width * 0.8, opacity: 0.75 + 0.25 * fall,
      }))
    }
    const trace = parts.join('')

    subject.push(trace)
    if (field.next() < 0.42) (i % 9 === 4 ? behind : back).push(trace)

    const score = Math.hypot(x - focal.cx, y - focal.cy)
    if (score < accentScore && legs > 4) {
      accentScore = score
      accent =
        el('path', {
          d, fill: 'none', stroke: palette.accent, 'stroke-width': u(2.8 * weightK),
          'stroke-linecap': 'square', 'stroke-linejoin': 'round',
        }) +
        el('path', {
          d, fill: 'none', stroke: withAlpha(palette.accent, 0.35), 'stroke-width': u(1),
          transform: `translate(${f(u(4) * ctx.light.dx)} ${f(-u(4) * ctx.light.dy)})`,
        }) +
        el('circle', { cx: x, cy: y, r: u(7), fill: palette.accent })
    }
  }

  // a bus of parallel traces crossing the mask edge and running off the frame
  const busY = focal.cy + skel.range(-0.7, 0.7) * focal.ry
  for (let k = 0; k < 4; k++) {
    front.push(el('path', {
      d: `M${f(-u(20))} ${f(busY + k * pitch * 0.34)}H${f(w + u(20))}`,
      stroke: withAlpha(ctx.ramp(1), 0.32 + 0.1 * k), 'stroke-width': u(1.6 * weightK), fill: 'none',
    }))
  }

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const circuitTraces: Renderer = {
  id: 'circuit-traces',
  name: 'Circuit Traces',
  family: 'technical',
  dark: true,
  focals: ['circle', 'diamond', 'ellipse', 'arch'],
  sampler: 'grid',
  schema,
  render,
}
