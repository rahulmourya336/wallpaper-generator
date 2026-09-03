import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Branching growth from seeds on the bottom edge. Each tip advances, thins,
 * and occasionally forks; branches that wander into the low-density field die
 * early, so the colony thickens inside the focal form on its own rather than
 * being masked into shape.
 *
 * The growth queue is capped and the wall clock is polled — an unbounded
 * branching loop is the same freeze risk as an unbounded packing loop.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Colony size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'turbulence', label: 'Wander', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'branch', label: 'Branching', type: 'range', min: 0.05, max: 1, step: 0.01, default: 0.45 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'arch', 'circle', 'ellipse', 'diamond'], default: 'auto' },
]

type Tip = { x: number; y: number; a: number; w: number; life: number }

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const field = ctx.rng
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const wander = ctx.num('turbulence')
  const branchK = ctx.num('branch')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const seeds = Math.max(4, Math.round(lerp(6, 22, densityK)))
  const step = ctx.short * 0.016
  const maxSegments = Math.round(lerp(1000, 3800, densityK) * Math.max(0.25, ctx.quality ** 0.6))
  const startW = u(lerp(8, 20, densityK))

  const queue: Tip[] = []
  for (let i = 0; i < seeds; i++) {
    queue.push({
      // biased toward the focal centre so the colony grows into the mask
      x: lerp(-w * 0.05, w * 1.05, (i + skel.range(0.2, 0.8)) / seeds) * 0.45 + focal.cx * 0.55,
      y: h + u(12),
      a: -Math.PI / 2 + skel.range(-0.4, 0.4),
      w: startW * skel.range(0.7, 1.3),
      life: 0,
    })
  }

  let segments = 0
  let accent: string | undefined
  let accentScore = Infinity

  // Breadth-first, via a read cursor rather than shift() so the queue stays
  // O(1) per step. Depth-first spends the whole segment budget driving one
  // filament to exhaustion and the result is a few long threads instead of a
  // colony — the growth order is what decides whether this reads as coral.
  let cursor = 0
  while (cursor < queue.length && segments < maxSegments) {
    if ((segments & 63) === 0 && ctx.expired()) break
    const tip = queue[cursor++] as Tip
    const dens = ctx.density(tip.x, tip.y)
    if (tip.w < u(0.8)) continue
    // Branches wandering into thin field die off, so the colony shapes itself.
    //
    // The rate compounds every step, so it has to sit below the branching rate
    // or the population declines and the colony never arrives. Seeds start on
    // the bottom edge, forty-odd steps from the focal form, through the weakest
    // part of the density field — at 13% per step that crossing survives about
    // once in two hundred attempts, which is why an earlier version rendered an
    // empty frame for some seeds and a colony for others. Young tips are exempt
    // outright, and taper is what actually ends a branch.
    if (tip.life > 14 && field.next() < 0.045 * (1 - dens)) continue

    const drift = ctx.fbm(n(tip.x) * 0.0032, n(tip.y) * 0.0032, 3) * wander * 1.5
    const a = tip.a + drift * 0.5 + skel.range(-0.12, 0.12) * wander
    const nx = tip.x + Math.cos(a) * step
    const ny = tip.y + Math.sin(a) * step
    const fall = ctx.falloff(nx, ny)

    const seg = el('path', {
      d: `M${f(tip.x)} ${f(tip.y)}L${f(nx)} ${f(ny)}`,
      stroke: ctx.ramp(0.3 + 0.6 * fall),
      'stroke-width': tip.w * weightK,
      'stroke-linecap': 'round',
      opacity: 0.55 + 0.45 * fall,
      fill: 'none',
    })
    subject.push(seg)
    if (field.next() < 0.45) (segments % 13 === 6 ? behind : back).push(seg)
    segments++

    const score = Math.hypot(nx - focal.cx, ny - focal.cy)
    if (score < accentScore && tip.w > startW * 0.35) {
      accentScore = score
      accent =
        el('path', {
          d: `M${f(tip.x)} ${f(tip.y)}L${f(nx)} ${f(ny)}`,
          stroke: palette.accent, 'stroke-width': tip.w * 1.5 * weightK,
          'stroke-linecap': 'round', fill: 'none',
        }) +
        el('circle', { cx: nx, cy: ny, r: tip.w * 1.3, fill: palette.accent }) +
        el('circle', {
          cx: nx + u(6) * ctx.light.dx, cy: ny - u(6) * ctx.light.dy, r: tip.w * 2.4,
          fill: 'none', stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.2),
        })
    }

    const taper = tip.w * lerp(0.997, 0.984, branchK)
    if (field.next() < branchK * 0.34 * (0.35 + dens)) {
      const spread = lerp(0.25, 0.85, branchK)
      queue.push({ x: nx, y: ny, a: a - spread, w: taper * 0.82, life: tip.life + 1 })
      queue.push({ x: nx, y: ny, a: a + spread, w: taper * 0.82, life: tip.life + 1 })
    } else {
      queue.push({ x: nx, y: ny, a, w: taper, life: tip.life + 1 })
    }
  }

  // polyps along the colony edge, and one frond crossing the mask
  for (let i = 0; i < 60; i++) {
    const a = skel.range(0, Math.PI * 2)
    const r = focal.rx * skel.range(0.4, 1.05)
    behind.push(el('circle', {
      cx: focal.cx + Math.cos(a) * r, cy: focal.cy + Math.sin(a) * r * 0.9,
      r: u(skel.range(1.5, 5)), fill: withAlpha(ctx.ramp(0.85), 0.3),
    }))
  }
  front.push(el('path', {
    d: `M${f(focal.cx - focal.rx * 1.4)} ${f(h + u(20))}` +
      `Q${f(focal.cx - focal.rx * 0.3)} ${f(focal.cy)} ${f(focal.cx + focal.rx * 1.2)} ${f(focal.cy - focal.ry * 1.2)}`,
    fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.55),
    'stroke-width': u(3 * weightK), 'stroke-linecap': 'round',
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const coralGrowth: Renderer = {
  id: 'coral-growth',
  name: 'Coral Growth',
  family: 'cellular',
  dark: true,
  palettes: ['verdigris', 'basalt', 'plum', 'ember', 'indigo', 'bone'],
  focals: ['arch', 'circle', 'ellipse', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
