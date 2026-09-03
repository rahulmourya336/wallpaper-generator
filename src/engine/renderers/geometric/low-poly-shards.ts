import { el, f, clamp, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import { lit } from '../../sampling'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Recursive triangle subdivision across the whole canvas. Depth is driven by
 * the density field, so facets shatter fine inside the focal form and stay
 * coarse outside it — the same surface at two resolutions rather than two
 * different textures.
 *
 * Facet value comes from the shared lighting helper, so every shard agrees
 * with the composition's one light source.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'turbulence', label: 'Skew', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.58 },
  { key: 'relief', label: 'Relief', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'outline', label: 'Outline', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'diamond', 'ellipse', 'arch'], default: 'auto' },
]

type Tri = [number, number, number, number, number, number]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette } = ctx
  const densityK = ctx.num('density')
  const skew = ctx.num('turbulence')
  const relief = ctx.num('relief')
  const outlineK = ctx.num('outline')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  // start beyond the frame so every shard bleeds off an edge
  const m = ctx.short * 0.12
  const x0 = -m, y0 = -m, x1 = w + m, y1 = h + m
  const seedTris: Tri[] = [
    [x0, y0, x1, y0, x0, y1],
    [x1, y0, x1, y1, x0, y1],
  ]

  // 2*2^want facets: want must reach 8-9 or the field reads as a handful of
  // flat shapes, which is the exact failure this project is trying to avoid.
  const maxDepth = 2 + Math.round(densityK * 3)
  const facets: Tri[] = []

  const split = (t: Tri, depth: number): void => {
    const cx = (t[0] + t[2] + t[4]) / 3
    const cy = (t[1] + t[3] + t[5]) / 3
    const local = ctx.density(cx, cy)
    const want = 4 + Math.round(local * maxDepth)
    if (depth >= want || depth >= 10 || ctx.expired()) {
      facets.push(t)
      return
    }
    // split the longest edge at a skewed midpoint
    const edges: Array<[number, number, number, number, number]> = [
      [t[0], t[1], t[2], t[3], 4],
      [t[2], t[3], t[4], t[5], 0],
      [t[4], t[5], t[0], t[1], 2],
    ]
    let best = edges[0] as (typeof edges)[number]
    let bestLen = -1
    for (const e of edges) {
      const len = Math.hypot(e[2] - e[0], e[3] - e[1])
      if (len > bestLen) { bestLen = len; best = e }
    }
    const k = 0.5 + skel.range(-0.22, 0.22) * skew
    const mx = lerp(best[0], best[2], k)
    const my = lerp(best[1], best[3], k)
    const ox = t[best[4]] as number
    const oy = t[best[4] + 1] as number
    split([best[0], best[1], mx, my, ox, oy], depth + 1)
    split([mx, my, best[2], best[3], ox, oy], depth + 1)
  }

  for (const t of seedTris) split(t, 0)

  let accent: string | undefined
  let accentScore = Infinity

  for (const t of facets) {
    const cx = (t[0] + t[2] + t[4]) / 3
    const cy = (t[1] + t[3] + t[5]) / 3
    const fall = ctx.falloff(cx, cy)
    // a pseudo-normal from the field: neighbouring facets tilt together
    const facing = ctx.fbm(ctx.n(cx) * 0.0016, ctx.n(cy) * 0.0016, 3) * Math.PI * 2
    const shade = clamp(lerp(0.5, lit(ctx, facing), relief), 0, 1)
    const d = `M${f(t[0])} ${f(t[1])}L${f(t[2])} ${f(t[3])}L${f(t[4])} ${f(t[5])}Z`

    const fill = ctx.ramp(0.1 + 0.72 * shade * (0.45 + 0.55 * fall))
    const facet =
      el('path', { d, fill, opacity: 0.86 + 0.14 * fall }) +
      (outlineK > 0.02
        ? el('path', {
            d, fill: 'none',
            stroke: withAlpha(ctx.ramp(0.9), 0.1 + 0.4 * outlineK * fall),
            'stroke-width': u(0.9),
            // misregistration: the outline that missed its fill
            transform: `translate(${f(u(2.4) * ctx.light.dx)} ${f(-u(2.4) * ctx.light.dy)})`,
          })
        : '')

    subject.push(facet)
    if (skel.next() < 0.3 + 0.5 * fall) back.push(facet)

    // one lit facet, the brightest large one nearest the focal centre
    const score = Math.hypot(cx - focal.cx, cy - focal.cy) / Math.max(0.15, shade)
    if (score < accentScore && shade > 0.6) {
      accentScore = score
      accent =
        el('path', { d, fill: palette.accent, opacity: 0.95 }) +
        el('path', {
          d, fill: 'none', stroke: withAlpha(palette.accent, 0.4),
          'stroke-width': u(1.4),
          transform: `translate(${f(u(6) * ctx.light.dx)} ${f(-u(6) * ctx.light.dy)})`,
        })
    }
  }

  // a fracture line crossing the whole frame, and one shard riding over the mask
  const fy = h * skel.range(0.42, 0.78)
  behind.push(el('path', {
    d: `M${f(-u(20))} ${f(fy)}L${f(w + u(20))} ${f(fy + skel.range(-1, 1) * ctx.short * 0.12)}`,
    stroke: withAlpha(ctx.ramp(0.95), 0.35), 'stroke-width': u(2.2), fill: 'none',
  }))
  const rider = facets[Math.floor(skel.next() * facets.length)]
  if (rider) {
    front.push(el('path', {
      d: `M${f(rider[0])} ${f(rider[1])}L${f(rider[2])} ${f(rider[3])}L${f(rider[4])} ${f(rider[5])}Z`,
      fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.6), 'stroke-width': u(2.6),
    }))
  }

  const scene: Scene = { back, behind, subject, front }
  if (accent) scene.accent = accent
  return scene
}

export const lowPolyShards: Renderer = {
  id: 'low-poly-shards',
  name: 'Low-Poly Shards',
  family: 'geometric',
  dark: true,
  palettes: ['basalt', 'graphite', 'plum', 'indigo', 'ember', 'chalk', 'seafog'],
  focals: ['circle', 'diamond', 'ellipse', 'arch'],
  sampler: 'field',
  schema,
  render,
}
