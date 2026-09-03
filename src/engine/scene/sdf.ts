/**
 * Signed distance representation.
 *
 * A path tells you where an edge is. A distance field tells you how far every
 * point in the plane is from that edge, and that extra information is what the
 * whole GPU pipeline is built on: ambient occlusion is a few samples of the
 * field, a soft shadow is a march through it with the penumbra falling out of
 * the distances encountered, subsurface warmth is the field read inside the
 * form as a thickness, and antialiasing is one smoothstep at any resolution.
 * None of those are available from an outline, which is why this is a separate
 * representation rather than something derived from `Path`.
 *
 * Shapes are a linear fold plus exactly one level of nesting, and the second
 * part is not optional — it was, and that was a bug.
 *
 * A fold alone gets an arch right: a box unioned with its head. It gets a ring
 * wrong, and the reason is the same property that makes it seem sufficient.
 * Subtracting shapes in sequence subtracts their union, so folding
 * "arch minus arch" flattens the inner arch's own internal subtraction up to
 * the outer level: instead of removing (head minus trim) unioned with jambs,
 * it removes head, trim and jambs separately — and the trim box is a large
 * rectangle that was never meant to exist on its own. Every ring came out with
 * a chunk cut through it.
 *
 * So a shape carries an optional `cut`, folded on its own and subtracted as a
 * unit. One level is enough for everything in the catalogue and costs a second
 * fixed loop in the shader rather than a stack.
 *
 * There is a hard cap of eight leaves per shape. The fold runs as a fixed loop
 * in the fragment shader, and an unbounded one would mean either a dynamic
 * loop, which is slow, or a shader recompile per composition, which costs more
 * than the render.
 */

export const MAX_LEAVES = 8

export type SdfLeaf =
  /** rounded box; `r` rounds the corners */
  | { k: 'box'; cx: number; cy: number; hw: number; hh: number; r: number }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  /** a thick line segment, which is what every stroke becomes */
  | { k: 'capsule'; x0: number; y0: number; x1: number; y1: number; r: number }

export type SdfOp = 'union' | 'smooth' | 'sub' | 'intersect'

export type SdfShape = {
  leaves: SdfLeaf[]
  /** ops[i] combines the running result with leaves[i + 1]; length leaves-1 */
  ops: SdfOp[]
  /** smoothing radius in design units, for 'smooth' */
  k: number
  /** folded separately, then subtracted from the result as one shape */
  cut?: { leaves: SdfLeaf[]; ops: SdfOp[] }
}

export const OP_CODE: Record<SdfOp, number> = { union: 0, smooth: 1, sub: 2, intersect: 3 }
export const LEAF_CODE = { box: 0, ellipse: 1, capsule: 2 } as const

export function shape(leaves: SdfLeaf[], ops: SdfOp[] = [], k = 0): SdfShape {
  return { leaves: leaves.slice(0, MAX_LEAVES), ops, k }
}

/** A minus B, where B is a whole shape rather than a leaf. */
export function cutShape(a: SdfShape, b: SdfShape): SdfShape {
  return { ...a, cut: { leaves: b.leaves.slice(0, MAX_LEAVES), ops: b.ops } }
}

/**
 * Conservative bounds, widened by the smoothing radius.
 *
 * Every primitive is drawn as a quad covering its own bounds rather than the
 * whole frame, so this is what keeps the field pass proportional to the area
 * the shapes actually occupy instead of pixels times primitives. It has to
 * over-estimate: a quad that stops short of the true extent leaves a visible
 * straight cut through the shape.
 */
export function shapeBounds(s: SdfShape): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (ax0: number, ay0: number, ax1: number, ay1: number) => {
    if (ax0 < x0) x0 = ax0
    if (ay0 < y0) y0 = ay0
    if (ax1 > x1) x1 = ax1
    if (ay1 > y1) y1 = ay1
  }
  for (const l of [...s.leaves, ...(s.cut?.leaves ?? [])]) {
    switch (l.k) {
      case 'box': add(l.cx - l.hw, l.cy - l.hh, l.cx + l.hw, l.cy + l.hh); break
      case 'ellipse': add(l.cx - l.rx, l.cy - l.ry, l.cx + l.rx, l.cy + l.ry); break
      default:
        add(
          Math.min(l.x0, l.x1) - l.r, Math.min(l.y0, l.y1) - l.r,
          Math.max(l.x0, l.x1) + l.r, Math.max(l.y0, l.y1) + l.r,
        )
    }
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 }
  const pad = s.k
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }
}

/**
 * Pack a shape into the two vec4 arrays and two int arrays the shader reads.
 *
 * Written into caller-supplied buffers so a composition of fifty nodes does
 * not allocate fifty times per frame.
 */
export function packShape(
  s: SdfShape,
  a: Float32Array,
  b: Float32Array,
  kinds: Int32Array,
  ops: Int32Array,
): number {
  const n = Math.min(s.leaves.length, MAX_LEAVES)
  for (let i = 0; i < n; i++) {
    const l = s.leaves[i] as SdfLeaf
    const o = i * 4
    switch (l.k) {
      case 'box':
        kinds[i] = LEAF_CODE.box
        a[o] = l.cx; a[o + 1] = l.cy; a[o + 2] = l.hw; a[o + 3] = l.hh
        b[o] = l.r; b[o + 1] = 0; b[o + 2] = 0; b[o + 3] = 0
        break
      case 'ellipse':
        kinds[i] = LEAF_CODE.ellipse
        a[o] = l.cx; a[o + 1] = l.cy; a[o + 2] = Math.max(1e-4, l.rx); a[o + 3] = Math.max(1e-4, l.ry)
        b[o] = 0; b[o + 1] = 0; b[o + 2] = 0; b[o + 3] = 0
        break
      default:
        kinds[i] = LEAF_CODE.capsule
        a[o] = l.x0; a[o + 1] = l.y0; a[o + 2] = l.x1; a[o + 3] = l.y1
        b[o] = l.r; b[o + 1] = 0; b[o + 2] = 0; b[o + 3] = 0
    }
    if (i > 0) ops[i] = OP_CODE[s.ops[i - 1] ?? 'union']
  }
  return n
}

/** An arch: jambs and a head, which is a box unioned with half an ellipse. */
export function archShape(
  cx: number, base: number, hw: number, h: number,
  springFrac: number, headRx: number, headRy: number, flip: number,
): SdfShape {
  const spring = base - flip * h * springFrac
  const jambH = (h * springFrac) / 2
  // Order matters, and the obvious order is wrong. The head is a full ellipse
  // that has to lose its far half, so the trim has to happen BEFORE the jambs
  // are unioned in — subtract afterwards and the same box that trims the head
  // also deletes the jambs, because they are on the side being cut away.
  return shape(
    [
      { k: 'ellipse', cx, cy: spring, rx: headRx, ry: Math.abs(headRy) },
      { k: 'box', cx, cy: spring + flip * Math.abs(headRy), hw: headRx * 1.6, hh: Math.abs(headRy), r: 0 },
      { k: 'box', cx, cy: base - flip * jambH, hw, hh: Math.abs(jambH), r: 0 },
    ],
    ['sub', 'union'],
    0,
  )
}
