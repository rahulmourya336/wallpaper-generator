/**
 * Path geometry for the scene graph.
 *
 * A `d` string is the wrong representation once anything downstream needs to
 * touch the geometry, and in the post pipeline everything does: hand-quality
 * jitter moves points, plate misregistration offsets a whole path per colour
 * channel, contact shadows need a footprint, filter regions need a bounding
 * box, and stroke weight modulates along arc length. A string forces a parse
 * at every one of those. So a path is two flat arrays and nothing else.
 *
 * There are no arcs in the representation. `arcTo` converts to cubics as it is
 * called, which costs a few lines here and removes a case from every pass that
 * ever walks a path — flattening, bounds, transform, jitter, rasterising. An
 * elliptical arc is exactly representable by at most four cubics, so nothing
 * is lost.
 */

export const OP = { move: 0, line: 1, quad: 2, cubic: 3, close: 4 } as const
export type Op = (typeof OP)[keyof typeof OP]

/** Coordinates consumed by each op, in pairs. */
const ARITY: Record<Op, number> = { 0: 1, 1: 1, 2: 2, 3: 3, 4: 0 }

export type Path = {
  ops: Uint8Array
  /** packed x,y pairs; see ARITY for how many belong to each op */
  pts: Float64Array
}

export type Bounds = { x0: number; y0: number; x1: number; y1: number }

export class PathBuilder {
  private ops: number[] = []
  private pts: number[] = []
  private cx = 0
  private cy = 0
  private sx = 0
  private sy = 0

  moveTo(x: number, y: number): this {
    this.ops.push(OP.move)
    this.pts.push(x, y)
    this.cx = this.sx = x
    this.cy = this.sy = y
    return this
  }

  lineTo(x: number, y: number): this {
    this.ops.push(OP.line)
    this.pts.push(x, y)
    this.cx = x
    this.cy = y
    return this
  }

  quadTo(qx: number, qy: number, x: number, y: number): this {
    this.ops.push(OP.quad)
    this.pts.push(qx, qy, x, y)
    this.cx = x
    this.cy = y
    return this
  }

  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.ops.push(OP.cubic)
    this.pts.push(c1x, c1y, c2x, c2y, x, y)
    this.cx = x
    this.cy = y
    return this
  }

  close(): this {
    this.ops.push(OP.close)
    this.cx = this.sx
    this.cy = this.sy
    return this
  }

  /** SVG arc parameters, converted to cubics immediately. */
  arcTo(
    rx: number, ry: number, rotDeg: number,
    largeArc: boolean, sweep: boolean,
    x: number, y: number,
  ): this {
    for (const seg of arcToCubics(this.cx, this.cy, rx, ry, rotDeg, largeArc, sweep, x, y)) {
      this.cubicTo(seg[0] as number, seg[1] as number, seg[2] as number, seg[3] as number, seg[4] as number, seg[5] as number)
    }
    if (this.ops[this.ops.length - 1] !== OP.cubic) this.lineTo(x, y)
    return this
  }

  /** Straight polyline from a flat [x0,y0,x1,y1,...] list. */
  polyline(flat: readonly number[] | Float64Array, closed = false): this {
    if (flat.length < 4) return this
    this.moveTo(flat[0] as number, flat[1] as number)
    for (let i = 2; i < flat.length; i += 2) this.lineTo(flat[i] as number, flat[i + 1] as number)
    if (closed) this.close()
    return this
  }

  build(): Path {
    return { ops: Uint8Array.from(this.ops), pts: Float64Array.from(this.pts) }
  }
}

export function path(): PathBuilder {
  return new PathBuilder()
}

/** Walk a path, calling back per command with its absolute points. */
export function walk(
  p: Path,
  fn: (op: Op, pts: Float64Array, offset: number) => void,
): void {
  let i = 0
  for (let k = 0; k < p.ops.length; k++) {
    const op = p.ops[k] as Op
    fn(op, p.pts, i)
    i += ARITY[op] * 2
  }
}

export function bounds(p: Path): Bounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  // Control points, not the true curve extrema. A curve never leaves its own
  // control hull, so this over-estimates and never under-estimates, which is
  // the only direction that matters for a filter region or a shadow footprint.
  for (let i = 0; i < p.pts.length; i += 2) {
    const x = p.pts[i] as number
    const y = p.pts[i + 1] as number
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 0, y1: 0 }
}

/** Affine transform in place on a copy. */
export function transform(
  p: Path,
  a: number, b: number, c: number, d: number, e: number, fy: number,
): Path {
  const pts = new Float64Array(p.pts.length)
  for (let i = 0; i < p.pts.length; i += 2) {
    const x = p.pts[i] as number
    const y = p.pts[i + 1] as number
    pts[i] = a * x + c * y + e
    pts[i + 1] = b * x + d * y + fy
  }
  return { ops: p.ops, pts }
}

export function translate(p: Path, dx: number, dy: number): Path {
  return transform(p, 1, 0, 0, 1, dx, dy)
}

/** Scale about a point; used for contact footprints and plate spread. */
export function scaleAbout(p: Path, k: number, ox: number, oy: number): Path {
  return transform(p, k, 0, 0, k, ox - k * ox, oy - k * oy)
}

const fmt = (n: number): string => {
  if (!Number.isFinite(n)) return '0'
  const prec = Math.abs(n) >= 100 ? 10 : 100
  const r = Math.round(n * prec) / prec
  return Object.is(r, -0) ? '0' : String(r)
}

/** The one place a path becomes a string, at the very edge of the pipeline. */
export function toD(p: Path): string {
  let d = ''
  walk(p, (op, pts, i) => {
    switch (op) {
      case OP.move: d += `M${fmt(pts[i] as number)} ${fmt(pts[i + 1] as number)}`; break
      case OP.line: d += `L${fmt(pts[i] as number)} ${fmt(pts[i + 1] as number)}`; break
      case OP.quad:
        d += `Q${fmt(pts[i] as number)} ${fmt(pts[i + 1] as number)},${fmt(pts[i + 2] as number)} ${fmt(pts[i + 3] as number)}`
        break
      case OP.cubic:
        d += `C${fmt(pts[i] as number)} ${fmt(pts[i + 1] as number)},${fmt(pts[i + 2] as number)} ${fmt(pts[i + 3] as number)},${fmt(pts[i + 4] as number)} ${fmt(pts[i + 5] as number)}`
        break
      default: d += 'Z'
    }
  })
  return d
}

/** And the one place it becomes something a canvas can fill. */
export function toPath2D(p: Path): Path2D {
  const out = new Path2D()
  walk(p, (op, pts, i) => {
    switch (op) {
      case OP.move: out.moveTo(pts[i] as number, pts[i + 1] as number); break
      case OP.line: out.lineTo(pts[i] as number, pts[i + 1] as number); break
      case OP.quad:
        out.quadraticCurveTo(pts[i] as number, pts[i + 1] as number, pts[i + 2] as number, pts[i + 3] as number)
        break
      case OP.cubic:
        out.bezierCurveTo(
          pts[i] as number, pts[i + 1] as number,
          pts[i + 2] as number, pts[i + 3] as number,
          pts[i + 4] as number, pts[i + 5] as number,
        )
        break
      default: out.closePath()
    }
  })
  return out
}

/**
 * Flatten to polylines, for anything that needs point samples rather than
 * curves: arc-length weight modulation, jitter, contact footprints.
 */
export function flatten(p: Path, steps = 12): number[][] {
  const runs: number[][] = []
  let run: number[] = []
  let cx = 0, cy = 0
  walk(p, (op, pts, i) => {
    switch (op) {
      case OP.move:
        if (run.length >= 4) runs.push(run)
        cx = pts[i] as number
        cy = pts[i + 1] as number
        run = [cx, cy]
        break
      case OP.line:
        cx = pts[i] as number
        cy = pts[i + 1] as number
        run.push(cx, cy)
        break
      case OP.quad: {
        const qx = pts[i] as number, qy = pts[i + 1] as number
        const x = pts[i + 2] as number, y = pts[i + 3] as number
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, m = 1 - t
          run.push(m * m * cx + 2 * m * t * qx + t * t * x, m * m * cy + 2 * m * t * qy + t * t * y)
        }
        cx = x; cy = y
        break
      }
      case OP.cubic: {
        const ax = pts[i] as number, ay = pts[i + 1] as number
        const bx = pts[i + 2] as number, by = pts[i + 3] as number
        const x = pts[i + 4] as number, y = pts[i + 5] as number
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, m = 1 - t
          run.push(
            m * m * m * cx + 3 * m * m * t * ax + 3 * m * t * t * bx + t * t * t * x,
            m * m * m * cy + 3 * m * m * t * ay + 3 * m * t * t * by + t * t * t * y,
          )
        }
        cx = x; cy = y
        break
      }
      default:
        if (run.length >= 4) {
          run.push(run[0] as number, run[1] as number)
          runs.push(run)
          run = []
        }
    }
  })
  if (run.length >= 4) runs.push(run)
  return runs
}

/**
 * SVG endpoint-parameterised arc to at most four cubics.
 *
 * The implementation follows the conversion in the SVG spec's implementation
 * notes: recover the centre, then emit one cubic per quarter turn, because the
 * error of a single cubic approximating a circular arc climbs sharply past
 * ninety degrees.
 */
function arcToCubics(
  x1: number, y1: number,
  rxIn: number, ryIn: number, rotDeg: number,
  largeArc: boolean, sweep: boolean,
  x2: number, y2: number,
): number[][] {
  if (rxIn === 0 || ryIn === 0 || (x1 === x2 && y1 === y2)) return []
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  const phi = (rotDeg * Math.PI) / 180
  const cosP = Math.cos(phi)
  const sinP = Math.sin(phi)

  const dx2 = (x1 - x2) / 2
  const dy2 = (y1 - y2) / 2
  const x1p = cosP * dx2 + sinP * dy2
  const y1p = -sinP * dx2 + cosP * dy2

  // an arc whose radii cannot span the chord is scaled up until it can
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    const k = Math.sqrt(lambda)
    rx *= k
    ry *= k
  }

  const sign = largeArc === sweep ? -1 : 1
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const coef = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (coef * rx * y1p) / ry
  const cyp = (-coef * ry * x1p) / rx
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2

  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1
    const a = Math.acos(Math.max(-1, Math.min(1, dot / len)))
    return ux * vy - uy * vx < 0 ? -a : a
  }

  const ux = (x1p - cxp) / rx
  const uy = (y1p - cyp) / ry
  const vx = (-x1p - cxp) / rx
  const vy = (-y1p - cyp) / ry
  const theta1 = ang(1, 0, ux, uy)
  let delta = ang(ux, uy, vx, vy)
  if (!sweep && delta > 0) delta -= Math.PI * 2
  if (sweep && delta < 0) delta += Math.PI * 2

  const segs = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)))
  const step = delta / segs
  const alpha = (Math.sin(step) * (Math.sqrt(4 + 3 * Math.tan(step / 2) ** 2) - 1)) / 3

  const at = (t: number) => {
    const c = Math.cos(t)
    const s = Math.sin(t)
    return [cx + rx * c * cosP - ry * s * sinP, cy + rx * c * sinP + ry * s * cosP] as const
  }
  const deriv = (t: number) => {
    const c = Math.cos(t)
    const s = Math.sin(t)
    return [-rx * s * cosP - ry * c * sinP, -rx * s * sinP + ry * c * cosP] as const
  }

  const out: number[][] = []
  for (let i = 0; i < segs; i++) {
    const t0 = theta1 + i * step
    const t1 = t0 + step
    const [px, py] = at(t0)
    const [dx0, dy0] = deriv(t0)
    const [qx, qy] = at(t1)
    const [dx1, dy1] = deriv(t1)
    out.push([px + alpha * dx0, py + alpha * dy0, qx - alpha * dx1, qy - alpha * dy1, qx, qy])
  }
  return out
}
