import { el, f, lerp, smooth } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Stems rising from below the bottom edge, each carrying paired leaves and a
 * seed head. Every stem is rooted off-canvas so nothing floats, and leaf size,
 * stem height and node count all decay away from the focal centre.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.58 },
  { key: 'turbulence', label: 'Sway', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'leaf', label: 'Leaf size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'arch', 'circle', 'ellipse'], default: 'auto' },
]

function leafPath(x: number, y: number, len: number, wide: number, angle: number): string {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const px = -dy * wide
  const py = dx * wide
  const tx = x + dx * len
  const ty = y + dy * len
  return (
    `M${f(x)} ${f(y)}` +
    `Q${f(x + dx * len * 0.5 + px)} ${f(y + dy * len * 0.5 + py)} ${f(tx)} ${f(ty)}` +
    `Q${f(x + dx * len * 0.5 - px)} ${f(y + dy * len * 0.5 - py)} ${f(x)} ${f(y)}Z`
  )
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const sway = ctx.num('turbulence')
  const leafK = ctx.num('leaf')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const stems = Math.round(lerp(14, 54, densityK) * Math.max(0.5, ctx.quality ** 0.5))
  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < stems; i++) {
    if ((i & 7) === 0 && ctx.expired()) break
    const rootX = lerp(-w * 0.05, w * 1.05, (i + skel.range(0.1, 0.9)) / stems)
    const rootY = h + u(skel.range(6, 60))
    const probeY = h * 0.62
    const fall = ctx.falloff(rootX, probeY)
    const dens = ctx.density(rootX, probeY)

    const height = ctx.short * lerp(0.28, 1.15, fall) * skel.range(0.7, 1.25)
    const segs = Math.max(5, Math.round(12 * (0.5 + 0.5 * fall)))
    const lean = ctx.fbm(n(rootX) * 0.004, 61, 3) * sway

    const pts: number[] = []
    for (let s = 0; s <= segs; s++) {
      const t = s / segs
      const y = rootY - height * t
      const bend = Math.sin(t * 2.1 + lean * 3) * ctx.short * 0.05 * sway
      const drift = ctx.fbm(n(rootX) * 0.004 + t * 0.9, 61, 3) * ctx.short * 0.05 * sway
      pts.push(rootX + bend + drift + lean * ctx.short * 0.06 * t, y)
    }
    const stemPath = smooth(pts, 0.5)
    const stemWidth = u(lerp(0.9, 3.6, fall) * weightK)
    const tone = ctx.ramp(0.34 + 0.56 * fall)

    const parts: string[] = [
      el('path', {
        d: stemPath, fill: 'none', stroke: tone, 'stroke-width': stemWidth,
        opacity: 0.5 + 0.5 * fall, 'stroke-linecap': 'round',
      }),
    ]

    // paired leaves at alternating nodes
    const nodes = Math.max(2, Math.round(lerp(3, 9, dens)))
    for (let k = 1; k <= nodes; k++) {
      const t = k / (nodes + 1)
      const idx = Math.min(segs, Math.round(t * segs)) * 2
      const nx2 = pts[idx] as number
      const ny2 = pts[idx + 1] as number
      const leafLen = ctx.short * lerp(0.03, 0.115, leafK) * (0.45 + 0.55 * fall) * (1 - t * 0.45)
      const spread = skel.range(0.55, 1.15)
      for (const side of [-1, 1]) {
        const angle = -Math.PI * 0.5 + side * spread
        parts.push(el('path', {
          d: leafPath(nx2, ny2, leafLen, leafLen * 0.34, angle),
          fill: ctx.ramp(0.2 + 0.4 * fall),
          stroke: withAlpha(ctx.ramp(0.85), 0.25 + 0.25 * fall),
          'stroke-width': u(0.8),
          opacity: 0.55 + 0.4 * fall,
        }))
      }
    }

    // seed head
    const tipX = pts[pts.length - 2] as number
    const tipY = pts[pts.length - 1] as number
    parts.push(el('circle', {
      cx: tipX, cy: tipY, r: u(lerp(3, 11, fall) * leafK * 1.4),
      fill: ctx.ramp(0.15 + 0.35 * fall),
      stroke: withAlpha(ctx.ramp(0.92), 0.4), 'stroke-width': u(1),
    }))

    const stem = parts.join('')
    subject.push(stem)
    if (skel.next() < 0.3 + 0.45 * fall) (i % 6 === 2 ? behind : back).push(stem)

    const score = Math.hypot(tipX - focal.cx, tipY - focal.cy)
    if (score < accentScore) {
      accentScore = score
      accent =
        el('path', {
          d: stemPath, fill: 'none', stroke: palette.accent,
          'stroke-width': u(2.6 * weightK), opacity: 0.9, 'stroke-linecap': 'round',
        }) +
        el('circle', { cx: tipX, cy: tipY, r: u(9 * leafK * 1.4), fill: palette.accent }) +
        el('circle', {
          cx: tipX + u(5) * ctx.light.dx, cy: tipY - u(5) * ctx.light.dy,
          r: u(9 * leafK * 1.4), fill: 'none',
          stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.2),
        })
    }
  }

  // one stem arcs over the mask edge and out of frame
  const arcX = focal.cx + skel.range(-0.6, 0.6) * focal.rx
  front.push(el('path', {
    d: `M${f(arcX)} ${f(h + u(20))}C${f(arcX + ctx.short * 0.1)} ${f(h * 0.55)},` +
      `${f(arcX - ctx.short * 0.22)} ${f(focal.cy - focal.ry * 0.6)},` +
      `${f(arcX + ctx.short * 0.3)} ${f(focal.cy - focal.ry * 1.3)}`,
    fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.7), 'stroke-width': u(2.6 * weightK),
    'stroke-linecap': 'round',
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const botanicalStems: Renderer = {
  id: 'botanical-stems',
  name: 'Botanical Stems',
  family: 'organic',
  dark: true,
  palettes: ['verdigris', 'basalt', 'ember', 'plum', 'graphite', 'dune', 'bone'],
  focals: ['arch', 'circle', 'ellipse'],
  sampler: 'field',
  schema,
  render,
}
