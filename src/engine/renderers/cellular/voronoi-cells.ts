import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import { lit } from '../../sampling'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Voronoi by half-plane clipping: each cell starts as the whole frame and is
 * cut by the perpendicular bisector against every nearby site. That is O(n·k)
 * with no triangulation to build, and at a few hundred sites it costs less
 * than the SVG it produces.
 *
 * Sites are drawn from the density field, so cells are small and crowded
 * inside the focal form and large and open outside it — one tessellation at
 * two scales rather than two textures.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Cell count', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'inset', label: 'Cell inset', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'relief', label: 'Relief', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'diamond', 'ellipse', 'arch'], default: 'auto' },
]

type P = [number, number]

/** Sutherland-Hodgman clip of a convex polygon by the half-plane a·x + b·y <= c. */
function clipHalfPlane(poly: P[], a: number, b: number, c: number): P[] {
  const out: P[] = []
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i] as P
    const nxt = poly[(i + 1) % poly.length] as P
    const dCur = a * cur[0] + b * cur[1] - c
    const dNxt = a * nxt[0] + b * nxt[1] - c
    if (dCur <= 0) out.push(cur)
    if ((dCur <= 0) !== (dNxt <= 0)) {
      const t = dCur / (dCur - dNxt)
      out.push([cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t])
    }
  }
  return out
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const field = ctx.rng
  const { w, h, u, focal, palette } = ctx
  const densityK = ctx.num('density')
  const insetK = ctx.num('inset')
  const relief = ctx.num('relief')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const m = ctx.short * 0.15
  const frame: P[] = [[-m, -m], [w + m, -m], [w + m, h + m], [-m, h + m]]

  // sites, rejection-sampled against the density field
  const target = Math.round(lerp(90, 420, densityK) * Math.max(0.3, ctx.quality ** 0.6))
  const sites: P[] = []
  for (let i = 0; i < target * 14 && sites.length < target; i++) {
    const x = field.range(-m, w + m)
    const y = field.range(-m, h + m)
    if (field.next() > ctx.density(x, y)) continue
    sites.push([x, y])
  }

  // Bucket the sites. Scanning and sorting all sites per cell is O(n^2 log n)
  // and blows the render budget at a few hundred cells; only sites within a
  // couple of buckets can contribute an edge.
  const bucket = Math.max(ctx.short / 12, 1)
  const bCols = Math.ceil((w + 2 * m) / bucket) + 4
  const buckets = new Map<number, P[]>()
  const bkey = (bx: number, by: number) => (by + 2) * bCols + (bx + 2)
  for (const s of sites) {
    const k = bkey(Math.floor((s[0] + m) / bucket), Math.floor((s[1] + m) / bucket))
    const list = buckets.get(k)
    if (list) list.push(s)
    else buckets.set(k, [s])
  }

  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < sites.length; i++) {
    if ((i & 15) === 0 && ctx.expired()) break
    const s = sites[i] as P
    let poly = frame

    const bx = Math.floor((s[0] + m) / bucket)
    const by = Math.floor((s[1] + m) / bucket)
    const near: P[] = []
    for (let ox = -2; ox <= 2; ox++) {
      for (let oy = -2; oy <= 2; oy++) {
        const list = buckets.get(bkey(bx + ox, by + oy))
        if (!list) continue
        for (const o of list) if (o !== s) near.push(o)
      }
    }

    for (const o of near) {
      const ax = o[0] - s[0]
      const ay = o[1] - s[1]
      const mx = (o[0] + s[0]) / 2
      const my = (o[1] + s[1]) / 2
      poly = clipHalfPlane(poly, ax, ay, ax * mx + ay * my)
      if (poly.length < 3) break
    }
    if (poly.length < 3) continue

    // shrink toward the site so the cells read as plates with mortar between
    const inset = 0.02 + 0.16 * insetK
    const shrunk = poly.map(([px, py]) => [
      px + (s[0] - px) * inset,
      py + (s[1] - py) * inset,
    ] as P)

    const d = `${shrunk.map(([px, py], k) => `${k ? 'L' : 'M'}${f(px)} ${f(py)}`).join('')}Z`
    const fall = ctx.falloff(s[0], s[1])
    const facing = ctx.fbm(ctx.n(s[0]) * 0.0018, ctx.n(s[1]) * 0.0018, 3) * Math.PI * 2
    const shade = lerp(0.5, lit(ctx, facing), relief)
    const width = u(lerp(0.8, 2.8, fall) * weightK)

    const cell =
      el('path', {
        d, fill: ctx.ramp(0.08 + 0.62 * shade * (0.4 + 0.6 * fall)),
        stroke: ctx.ramp(0.4 + 0.5 * fall), 'stroke-width': width,
        opacity: 0.7 + 0.3 * fall,
      }) +
      el('path', {
        d, fill: 'none', stroke: withAlpha(ctx.ramp(0.98), 0.12 + 0.2 * fall),
        'stroke-width': u(0.9),
        transform: `translate(${f(u(2.2) * ctx.light.dx)} ${f(-u(2.2) * ctx.light.dy)})`,
      })

    subject.push(cell)
    if (skel.next() < 0.55) (i % 9 === 4 ? behind : back).push(cell)

    const score = Math.hypot(s[0] - focal.cx, s[1] - focal.cy)
    if (score < accentScore) {
      accentScore = score
      accent =
        el('path', { d, fill: palette.accent }) +
        el('path', {
          d, fill: 'none', stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.6),
          transform: `translate(${f(u(7) * ctx.light.dx)} ${f(-u(7) * ctx.light.dy)})`,
        })
    }
  }

  // a fracture running the height of the frame, over the mask edge
  const fx = focal.cx + skel.range(-0.6, 0.6) * focal.rx
  front.push(el('path', {
    d: `M${f(fx - ctx.short * 0.18)} ${f(-u(20))}` +
      `Q${f(fx + ctx.short * 0.14)} ${f(focal.cy)} ${f(fx - ctx.short * 0.06)} ${f(h + u(20))}`,
    fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.45), 'stroke-width': u(2.2),
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const voronoiCells: Renderer = {
  id: 'voronoi-cells',
  name: 'Voronoi Cells',
  family: 'cellular',
  dark: true,
  focals: ['circle', 'diamond', 'ellipse', 'arch'],
  sampler: 'field',
  schema,
  render,
}
