import type { RenderContext } from './types'
import type { Rng } from './rng'
import { f } from './svg'

export type Pt = { x: number; y: number }

/**
 * Walk a jittered grid over the canvas with one cell of bleed on every side,
 * so grid families never end on a clean interior edge.
 */
export function jitteredGrid(
  ctx: RenderContext,
  cell: number,
  jitter: number,
  rng: Rng,
  visit: (x: number, y: number, col: number, row: number) => void,
): void {
  const cols = Math.ceil(ctx.w / cell) + 2
  const rows = Math.ceil(ctx.h / cell) + 2
  for (let row = -1; row < rows - 1; row++) {
    for (let col = -1; col < cols - 1; col++) {
      const jx = rng.range(-jitter, jitter) * cell
      const jy = rng.range(-jitter, jitter) * cell
      visit(col * cell + cell * 0.5 + jx, row * cell + cell * 0.5 + jy, col, row)
    }
  }
}

export type PackedCircle = Pt & { r: number }

/**
 * Rejection-sampled circle packing. Attempts are capped and the wall clock is
 * polled: an uncapped packing loop will freeze the slider, and a cheap bail-out
 * with fewer circles beats a stall.
 */
export function packCircles(
  ctx: RenderContext,
  opts: { target: number; rMin: number; rMax: number; padding?: number; attempts?: number },
): PackedCircle[] {
  const { target, rMin, rMax } = opts
  const padding = opts.padding ?? 0
  const maxAttempts = opts.attempts ?? target * 30
  const rng = ctx.rng
  const out: PackedCircle[] = []

  // uniform bucket grid, so each attempt tests a handful of neighbours not all
  const bucket = Math.max(rMax * 2 + padding, 1)
  const cols = Math.ceil(ctx.w / bucket) + 4
  const grid = new Map<number, PackedCircle[]>()
  const key = (cx: number, cy: number) => (cy + 2) * cols + (cx + 2)

  for (let attempt = 0; attempt < maxAttempts && out.length < target; attempt++) {
    if ((attempt & 63) === 0 && ctx.expired()) break
    const x = rng.range(-rMax, ctx.w + rMax)
    const y = rng.range(-rMax, ctx.h + rMax)
    const d = ctx.density(x, y)
    if (rng.next() > d) continue
    let r = rng.range(rMin, rMax) * (0.45 + 0.55 * d)

    const gx = Math.floor(x / bucket)
    const gy = Math.floor(y / bucket)
    let ok = true
    for (let ox = -1; ox <= 1 && ok; ox++) {
      for (let oy = -1; oy <= 1 && ok; oy++) {
        const cellList = grid.get(key(gx + ox, gy + oy))
        if (!cellList) continue
        for (const c of cellList) {
          const dist = Math.hypot(c.x - x, c.y - y) - c.r - padding
          if (dist < rMin) { ok = false; break }
          if (dist < r) r = dist
        }
      }
    }
    if (!ok || r < rMin) continue

    const circle = { x, y, r }
    out.push(circle)
    const k = key(gx, gy)
    const list = grid.get(k)
    if (list) list.push(circle)
    else grid.set(k, [circle])
  }
  return out
}

/**
 * Integrate a streamline through an angle field. Returns a flat point list
 * suitable for poly()/smooth().
 */
export function streamline(
  ctx: RenderContext,
  start: Pt,
  angleAt: (x: number, y: number) => number,
  steps: number,
  step: number,
): number[] {
  const pts: number[] = []
  let { x, y } = start
  const margin = ctx.short * 0.3
  for (let i = 0; i < steps; i++) {
    pts.push(x, y)
    const a = angleAt(x, y)
    x += Math.cos(a) * step
    y += Math.sin(a) * step
    if (x < -margin || x > ctx.w + margin || y < -margin || y > ctx.h + margin) break
  }
  return pts
}

/** A closed irregular polygon around a centre — chips, cells, facets. */
export function blob(
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rng: Rng,
  irregularity = 0.35,
): string {
  let d = ''
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + rng.range(-0.2, 0.2)
    const rr = r * (1 - irregularity * rng.next())
    d += `${i === 0 ? 'M' : 'L'}${f(cx + Math.cos(a) * rr)} ${f(cy + Math.sin(a) * rr)}`
  }
  return `${d}Z`
}

/**
 * How lit a surface is, given its facing direction and the composition's single
 * light source. Every family that fills shapes should route through this so all
 * shadows agree.
 */
export function lit(ctx: RenderContext, facingAngle: number): number {
  return 0.5 + 0.5 * Math.cos(facingAngle - ctx.light.angle)
}

/**
 * Raise a grid cell size until the grid stays under `maxCells`.
 *
 * Grid families multiply: halving the cell quadruples the element count. Left
 * uncapped, the finest setting on a "thread pitch" or "stitch count" slider
 * produces ten thousand nodes and a megabyte of SVG source, which the
 * compositor's time budget does not catch because the cost is in parsing and
 * painting the result rather than in building it.
 *
 * `cells` is computed from px that all scale together, so the cap lands at the
 * same value from thumbnail to 4x export and the composition stays
 * deterministic. Defaults sit well inside every cap, so this only bites at the
 * extremes it exists for.
 */
export function capCell(ctx: RenderContext, cell: number, maxCells: number): number {
  if (!(cell > 0)) return Math.max(1, ctx.u(20))
  const cells = (ctx.w / cell) * (ctx.h / cell)
  return cells <= maxCells ? cell : cell * Math.sqrt(cells / maxCells)
}
