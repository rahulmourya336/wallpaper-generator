import { mixHex, withAlpha } from '../../palette'
import { el, f, lerp, poly } from '../../svg'
import type { Rng } from '../../rng'
import type { Focal, ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Terrazzo as a poured and cut material, not as confetti.
 *
 * The old pass scattered a thousand rounded blobs of one size class evenly over
 * the whole frame and tinted a form on top of them, which is the definition of
 * a macro texture — and this family is printed, where scale contrast is meant
 * to do the work. Nothing here is scattered over the frame any more. The
 * aggregate is POURED INTO SHAPES: a few slabs big enough to run off the edge,
 * and the focal form itself, each packed with chips whose radii follow a power
 * law so the coarse and the fine sit in the same bed. Between the shapes the
 * ground is left bare on purpose.
 *
 * The other half is where the value lives. The compositor lays ramp[0] almost
 * opaque over the focal form, so the two sides of the rim already start at
 * different values: a slab that crosses the edge is filled dark outside and
 * pale inside, and its aggregate flips with it. That turns the silhouette into
 * a boundary in the material rather than a colour wash sitting over it.
 */

const TAU = Math.PI * 2

type P = { x: number; y: number }
type Chip = { x: number; y: number; r: number }
type Tone = { c: string; w: number }

const schema: ParamSchema = [
  { key: 'density', label: 'Aggregate', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'chip', label: 'Chip size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'slab', label: 'Slabs', type: 'range', min: 2, max: 6, step: 1, default: 3 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'variety', label: 'Fracture', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'outline', label: 'Bevel', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'arch', 'diamond'], default: 'auto' },
]

/** Monotone-chain hull. Small sets only — this runs once per chip. */
function hull(pts: readonly P[]): P[] {
  const s = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (src: readonly P[]): P[] => {
    const out: P[] = []
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2] as P, out[out.length - 1] as P, q) <= 0) out.pop()
      out.push(q)
    }
    out.pop()
    return out
  }
  const h = half(s).concat(half(s.slice().reverse()))
  return h.length >= 3 ? h : pts.slice()
}

/**
 * A broken-stone silhouette.
 *
 * Scatter points on a ragged ring and take their hull: the hull throws away
 * the points that would have made a soft many-sided blob and leaves long
 * straight runs meeting at sharp corners, which is what a chipped aggregate
 * edge looks like. Then one edge is bitten inward, because a purely convex
 * stone reads as a pebble.
 */
function shard(cx: number, cy: number, r: number, n: number, rough: number, rng: Rng, notch = true): P[] {
  const pts: P[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.range(-0.6, 0.6) * (TAU / n)
    const rr = r * (1 - rough * rng.next())
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr })
  }
  const h = hull(pts)
  if (!notch || h.length < 4) return h
  const k = rng.int(0, h.length - 1)
  const a = h[k] as P
  const b = h[(k + 1) % h.length] as P
  const t = rng.range(0.34, 0.66)
  h.splice(k + 1, 0, {
    x: cx + ((a.x + b.x) / 2 - cx) * t,
    y: cy + ((a.y + b.y) / 2 - cy) * t,
  })
  return h
}

function shape(pts: readonly P[]): string {
  const flat: number[] = []
  for (const q of pts) flat.push(q.x, q.y)
  return poly(flat, true)
}

function centroid(pts: readonly P[]): P {
  let x = 0
  let y = 0
  for (const q of pts) {
    x += q.x
    y += q.y
  }
  return { x: x / pts.length, y: y / pts.length }
}

function area(pts: readonly P[]): number {
  let a = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const p1 = pts[i] as P
    const p2 = pts[j] as P
    a += p2.x * p1.y - p1.x * p2.y
  }
  return Math.abs(a) / 2
}

function inside(pts: readonly P[], x: number, y: number): boolean {
  let hit = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as P
    const b = pts[j] as P
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/**
 * Where a form's silhouette crosses a ray from its centre.
 *
 * `norm` is homogeneous for every focal but the arch, so one fixed-point step
 * lands exactly and three land close enough on the arch. This is what lets the
 * rim gather on the real edge of a diamond rather than on a circle inscribed
 * in it.
 */
function rimRadius(foc: Focal, dx: number, dy: number, seedR: number): number {
  let r = seedR
  for (let i = 0; i < 3; i++) {
    const n = foc.norm(foc.cx + dx * r, foc.cy + dy * r)
    if (!(n > 1e-4)) break
    r = r / n
  }
  return r
}

/**
 * Pack a region with chips whose radii follow a power law.
 *
 * The size distribution is the whole point: a uniform radius between two
 * bounds is one size class wearing a disguise, and that is what made the old
 * field read as confetti. Raising a uniform draw to a power puts most of the
 * mass at the fine end and leaves a handful of coarse stones per region, which
 * is how a real pour grades. Each accepted chip also shrinks to touch its
 * neighbours, so the bed is tight rather than a scatter of separated dots.
 */
function pack(
  rng: Rng,
  box: { x0: number; y0: number; x1: number; y1: number },
  target: number,
  rMin: number,
  rMax: number,
  pad: number,
  accept: (x: number, y: number, r: number) => boolean,
  expired: () => boolean,
): Chip[] {
  const out: Chip[] = []
  if (!(rMax > rMin) || target < 1) return out
  const cell = Math.max(rMax * 2 + pad, 1)
  const cols = Math.ceil((box.x1 - box.x0) / cell) + 3
  const grid = new Map<number, Chip[]>()
  const key = (gx: number, gy: number) => (gy + 1) * cols + (gx + 1)
  const attempts = target * 16
  for (let i = 0; i < attempts && out.length < target; i++) {
    if ((i & 255) === 0 && expired()) break
    const x = rng.range(box.x0, box.x1)
    const y = rng.range(box.y0, box.y1)
    let r = rMin * (rMax / rMin) ** rng.next() ** 2.6
    if (!accept(x, y, r)) continue
    const gx = Math.floor((x - box.x0) / cell)
    const gy = Math.floor((y - box.y0) / cell)
    let ok = true
    for (let ox = -1; ox <= 1 && ok; ox++) {
      for (let oy = -1; oy <= 1 && ok; oy++) {
        const list = grid.get(key(gx + ox, gy + oy))
        if (!list) continue
        for (const c of list) {
          const gap = Math.hypot(c.x - x, c.y - y) - c.r - pad
          if (gap < rMin) { ok = false; break }
          if (gap < r) r = gap
        }
      }
    }
    if (!ok) continue
    const chip = { x, y, r }
    out.push(chip)
    const k = key(gx, gy)
    const list = grid.get(k)
    if (list) list.push(chip)
    else grid.set(k, [chip])
  }
  return out
}

function pickTone(rng: Rng, table: readonly Tone[]): string {
  let total = 0
  for (const t of table) total += t.w
  let x = rng.next() * total
  for (const t of table) {
    x -= t.w
    if (x <= 0) return t.c
  }
  return (table[table.length - 1] as Tone).c
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const grit = ctx.rng
  const { u, focal, focals, palette: p, light, w, h, short } = ctx

  const densityK = ctx.num('density')
  const chipK = ctx.num('chip')
  const variety = ctx.num('variety')
  const bevelK = ctx.num('outline')
  const slabCount = Math.max(2, Math.round(ctx.num('slab')))
  /**
   * `quality` carries the layout's zoom, and a close crop shows less field for
   * the same element count. Capping it at one leaves the macro layouts as a
   * few big cutouts on bare ground with no aggregate in them, so it climbs —
   * but not without limit, since the whole pour is paths.
   */
  const q = Math.max(0.4, Math.min(1.8, ctx.quality ** 0.75))

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []
  const defs: string[] = []

  /**
   * Two value worlds, one material.
   *
   * `air` is the palest mark available — the ground itself, since the ramp
   * never returns it — and it is the only thing that reads as light against
   * the tinted form. So each bed gets its own table: dark aggregate on the
   * pale ground, light aggregate on the form, and the reverse again inside a
   * dark slab. Nothing is drawn at one weight anywhere.
   */
  const air = p.ground
  const pale = mixHex(p.ground, ctx.ramp(0.4), 0.16)
  const shadowOut = mixHex(p.ground, ctx.ramp(0.9), 0.34)
  const shadowIn = mixHex(ctx.ramp(0.1), ctx.ramp(0.9), 0.4)

  const onGround: Tone[] = [
    { c: ctx.ramp(0.34), w: 3 }, { c: ctx.ramp(0.56), w: 3 },
    { c: ctx.ramp(0.78), w: 2 }, { c: ctx.ramp(0.97), w: 1 },
    { c: air, w: 1.5 }, { c: pale, w: 1.3 },
  ]
  const onForm: Tone[] = [
    { c: air, w: 3.4 }, { c: pale, w: 1.8 },
    { c: ctx.ramp(0.6), w: 2.6 }, { c: ctx.ramp(0.9), w: 2 }, { c: ctx.ramp(0.34), w: 1.2 },
  ]
  const onDark: Tone[] = [
    { c: air, w: 4 }, { c: pale, w: 2.6 },
    { c: ctx.ramp(0.22), w: 1.6 }, { c: ctx.ramp(0.98), w: 1.6 },
  ]
  const onPale: Tone[] = [
    { c: ctx.ramp(0.46), w: 3 }, { c: ctx.ramp(0.72), w: 2.4 },
    { c: ctx.ramp(0.97), w: 1.2 }, { c: air, w: 1.2 },
  ]

  // the printed offset: a hard-edged duplicate, not a photographic penumbra
  const off = u(lerp(4, 12, bevelK))
  const shift = (k: number) => `translate(${f(-light.dx * k)} ${f(-light.dy * k)})`

  /**
   * A chip is cut once and painted per value world.
   *
   * A stone that crosses the form's rim has to be the same stone on both sides
   * of it — same silhouette, same split, opposite value — so the geometry is
   * carved once and the fill is chosen twice.
   */
  const carve = (c: Chip, rng: Rng): { d: string; crack: string } => {
    const coarse = c.r > u(11)
    const pts = shard(c.x, c.y, c.r, coarse ? rng.int(5, 8) : 4, 0.28 + 0.38 * variety, rng, c.r > u(5))
    let crack = ''
    // the two corners must differ: a chord from a vertex to itself is a
    // zero-length stroke, which has no bounding box, and one rasteriser we
    // depend on aborts the whole process on a shape with no bounding box
    if (coarse && pts.length > 3 && rng.next() < 0.55) {
      const g = centroid(pts)
      const ia = rng.int(0, pts.length - 1)
      const a = pts[ia] as P
      const b = pts[(ia + rng.int(1, pts.length - 1)) % pts.length] as P
      crack = poly([
        g.x + (a.x - g.x) * 0.9, g.y + (a.y - g.y) * 0.9,
        g.x + (b.x - g.x) * 0.9, g.y + (b.y - g.y) * 0.9,
      ])
    }
    return { d: shape(pts), crack }
  }
  const paint = (cut: { d: string; crack: string }, fill: string, crackTone: string): string =>
    el('path', { d: cut.d, fill }) +
    (cut.crack
      ? el('path', {
          d: cut.crack, fill: 'none', stroke: withAlpha(crackTone, 0.4),
          'stroke-width': u(1.4),
        })
      : '')
  const stone = (c: Chip, fill: string, rng: Rng, crackTone: string): string =>
    paint(carve(c, rng), fill, crackTone)

  // --- the ground is two masses, not one flat field ------------------------
  // A wandering edge with fbm on it, run well past the field bounds so the
  // layout's rotation can never expose where it stops. The seam is kept: the
  // pour gathers along it later, the same way it gathers on the form's rim.
  let groundEdge: number[] = []
  {
    const ang = skel.range(0, TAU)
    const nx = Math.cos(ang)
    const ny = Math.sin(ang)
    const cx = w / 2 + nx * short * skel.range(-0.2, 0.2)
    const cy = h / 2 + ny * short * skel.range(-0.2, 0.2)
    const span = (w + h) * 1.3
    const amp = short * lerp(0.05, 0.14, variety)
    const edge: number[] = []
    const steps = 30
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps - 0.5) * span
      const d = ctx.fbm(ctx.n(t) * 0.004 + 11.3, ctx.n(t) * 0.0011 + 4.7, 3) * amp
      edge.push(cx - ny * t + nx * d, cy + nx * t + ny * d)
    }
    groundEdge = edge.slice()
    edge.push(cx - ny * (span / 2) + nx * span, cy + nx * (span / 2) + ny * span)
    edge.push(cx + ny * (span / 2) + nx * span, cy - nx * (span / 2) + ny * span)
    const d = poly(edge, true)
    back.push(el('path', { d, fill: mixHex(p.ground, ctx.ramp(0.2), 0.24) }))
    subject.push(el('path', { d, fill: withAlpha(air, 0.4) }))
  }

  /**
   * How much of an element can reach each side of the rim.
   *
   * The compositor clips `back` to outside the form and `subject` to inside
   * it, so anything straddling the edge has to be emitted twice, once per
   * value world. Anything that clearly cannot reach a side is not emitted
   * there, which keeps the document from doubling for no picture.
   */
  const spans = (x: number, y: number, r: number): { out: boolean; in: boolean } => {
    let allOut = true
    let anyIn = false
    for (const foc of focals) {
      const s = Math.max(1, Math.min(foc.rx, foc.ry))
      const dr = (r * 1.4) / s
      const n = foc.norm(x, y)
      if (n - dr <= 1) allOut = false
      if (n + dr < 1) anyIn = true
    }
    return { out: !anyIn, in: !allOut }
  }

  const chipBudget = Math.round(lerp(620, 1250, densityK) * q)
  const fine = u(lerp(2.2, 3.2, chipK))
  const coarse = u(lerp(16, 40, chipK))

  // --- slabs: the big shapes the printed direction is asking for -----------
  type Slab = { pts: P[]; c: P; r: number; id: string; box: { x0: number; y0: number; x1: number; y1: number } }
  const slabs: Slab[] = []
  /**
   * The rest are thrown into the part of the frame the subject is not in.
   *
   * Spread evenly around the centre they piled up on the form and left a whole
   * corner of the frame as dead ground, which is not the same thing as
   * negative space. Aiming them away from the subject gives the empty half a
   * mass of its own to be empty around.
   */
  const away = Math.hypot(w / 2 - focal.cx, h / 2 - focal.cy) > short * 0.1
    ? Math.atan2(h / 2 - focal.cy, w / 2 - focal.cx)
    : skel.range(0, TAU)
  for (let i = 0; i < slabCount; i++) {
    // one slab is planted across the form's edge; that is the job the old
    // lone oversized chip was doing badly, and a slab does it with mass
    const onRim = i === 0
    const fan = slabCount > 2 ? ((i - 1) / (slabCount - 2) - 0.5) * 2.4 : skel.range(-0.8, 0.8)
    const a = onRim ? skel.range(0, TAU) : away + fan + skel.range(-0.32, 0.32)
    const reach = onRim
      ? Math.max(focal.rx, focal.ry) * skel.range(0.6, 1.0)
      : short * skel.range(0.34, 0.72)
    const ox = onRim ? focal.cx : w / 2
    const oy = onRim ? focal.cy : h / 2
    const r = short * lerp(0.25, 0.5, Math.min(1, skel.next() * (0.5 + 0.5 * variety) + (onRim ? 0.3 : 0)))
    const pts = shard(
      ox + Math.cos(a) * reach, oy + Math.sin(a) * reach,
      r, skel.int(6, 9), 0.28 + 0.32 * variety, skel,
    )
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const pt of pts) {
      if (pt.x < x0) x0 = pt.x
      if (pt.y < y0) y0 = pt.y
      if (pt.x > x1) x1 = pt.x
      if (pt.y > y1) y1 = pt.y
    }
    slabs.push({ pts, c: centroid(pts), r, id: `${ctx.uid}-sl${i}`, box: { x0, y0, x1, y1 } })
  }

  // budget split by area, flattened so a small slab still reads as poured
  const frame = w * h
  const weights = slabs.map((s) => (area(s.pts) / frame) ** 0.7)
  let formArea = 0
  for (const foc of focals) formArea += Math.PI * foc.rx * foc.ry
  // the form is the subject: it is poured heavier than its area alone asks
  //  for, or it goes back to reading as a tint over the aggregate
  const formWeight = 1.5 * (Math.min(formArea, frame * 1.1) / frame) ** 0.7
  const totalWeight = weights.reduce((s, x) => s + x, 0) + formWeight + 0.28

  const accentSlab = skel.int(0, slabs.length - 1)
  const accentBits: string[] = []

  /**
   * Nothing is drawn where nothing can be seen.
   *
   * The layout zooms the field until it covers the frame, so field space runs
   * well past the crop and a slab thrown at the edge can land entirely outside
   * it. Emitting it anyway costs kilobytes for no picture, and a clipped group
   * whose contents miss the canvas is also the shape that aborts the headless
   * rasteriser we render contact sheets with.
   */
  const margin = short * 0.12
  const onCanvas = (b: { x0: number; y0: number; x1: number; y1: number }) =>
    b.x1 > -margin && b.y1 > -margin && b.x0 < w + margin && b.y0 < h + margin

  for (let i = 0; i < slabs.length; i++) {
    if (ctx.expired()) break
    const slab = slabs[i] as Slab
    if (!onCanvas(slab.box)) continue
    const d = shape(slab.pts)
    const side = spans(slab.c.x, slab.c.y, slab.r)
    const dark = ctx.ramp(lerp(0.34, 0.84, skel.next()))

    defs.push(el('clipPath', { id: slab.id, clipPathUnits: 'userSpaceOnUse' }, el('path', { d })))

    /**
     * Lit and unlit edges, taken one at a time.
     *
     * A stroke around the whole polygon is an outline, and an outline is the
     * clip-art tell. Only the edges whose outward normal faces the light get
     * the bright line and only the ones facing away get the dark one, so the
     * cut edge of the stone carries the light instead of being drawn around.
     */
    const litRuns: number[][] = []
    const darkRuns: number[][] = []
    for (let k = 0; k < slab.pts.length; k++) {
      const a = slab.pts[k] as P
      const b = slab.pts[(k + 1) % slab.pts.length] as P
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 1e-3) continue
      // the ring can wind either way out of the hull, so the normal is turned
      // outward against the centroid rather than trusted from the winding
      let nx = -(b.y - a.y) / len
      let ny = (b.x - a.x) / len
      if (nx * ((a.x + b.x) / 2 - slab.c.x) + ny * ((a.y + b.y) / 2 - slab.c.y) < 0) {
        nx = -nx
        ny = -ny
      }
      const face = nx * light.dx + ny * light.dy
      if (face > 0.3) litRuns.push([a.x, a.y, b.x, b.y])
      else if (face < -0.3) darkRuns.push([a.x, a.y, b.x, b.y])
    }
    const runs = (rr: number[][], stroke: string, wid: number, op: number) =>
      rr.map((seg) => el('path', {
        d: poly(seg), fill: 'none', stroke: withAlpha(stroke, op), 'stroke-width': wid,
        'stroke-linecap': 'butt',
      })).join('')

    const target = Math.round((chipBudget * (weights[i] as number)) / totalWeight)
    const chips = pack(
      grit, slab.box, target, fine, Math.min(coarse, slab.r * 0.42), u(1.2),
      (x, y) => inside(slab.pts, x, y),
      ctx.expired,
    )
    // the same stones, cast once per value world: light aggregate in the dark
    // half of the slab, dark aggregate in the pale half
    const cuts = chips.map((c) => carve(c, grit))
    const cast = (table: Tone[], crack: string) =>
      cuts.map((cut) => paint(cut, pickTone(grit, table), crack)).join('')

    if (side.out) {
      back.push(el('path', { d, fill: shadowOut, transform: shift(off) }))
      back.push(el('path', { d, fill: dark }))
      back.push(el('g', { 'clip-path': `url(#${slab.id})` }, cast(onDark, air)))
      if (bevelK > 0.05) {
        back.push(runs(litRuns, air, u(1.6 + 2.6 * bevelK), 0.6))
        back.push(runs(darkRuns, ctx.ramp(0.97), u(1 + 1.8 * bevelK), 0.4))
      }
    }
    if (side.in) {
      subject.push(el('path', { d, fill: shadowIn, transform: shift(off * 0.55) }))
      subject.push(el('path', { d, fill: i === 0 ? air : pale }))
      subject.push(el('g', { 'clip-path': `url(#${slab.id})` }, cast(onPale, ctx.ramp(0.9))))
      if (bevelK > 0.05) subject.push(runs(darkRuns, ctx.ramp(0.74), u(1.6 + 2.6 * bevelK), 0.5))
    }

    /**
     * The accent is a seam, not a dot.
     *
     * Six or seven chips of one colour inside a single stone read as a vein of
     * another mineral in that pour; one chip somewhere among a thousand reads
     * as a mistake, which is what the old accent was.
     */
    if (i === accentSlab && chips.length > 8) {
      const veinAngle = skel.range(0, TAU)
      const scored = chips
        .slice()
        .sort((a, b) => b.r - a.r)
        .slice(0, Math.max(10, Math.round(chips.length * 0.4)))
        .map((c) => ({
          c,
          t: Math.abs((c.x - slab.c.x) * Math.sin(veinAngle) - (c.y - slab.c.y) * Math.cos(veinAngle)),
        }))
        .sort((a, b) => a.t - b.t)
        .slice(0, 8)
      for (const s of scored) {
        accentBits.push(el('path', {
          d: shape(shard(s.c.x, s.c.y, Math.max(s.c.r * 1.1, u(5)), 5, 0.34, skel)),
          fill: p.accent,
        }))
      }
    }
  }

  /**
   * The form, poured.
   *
   * Chips are packed to the silhouette and stopped a couple of units short of
   * it, so the ring of bare tint left behind is a grout line and the form is
   * made of the material rather than tinted over it. Everything here goes into
   * `subject`, which the compositor clips to the form for us.
   */
  {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const foc of focals) {
      x0 = Math.min(x0, foc.cx - foc.rx * 1.15)
      y0 = Math.min(y0, foc.cy - foc.ry * 1.15)
      x1 = Math.max(x1, foc.cx + foc.rx * 1.15)
      y1 = Math.max(y1, foc.cy + foc.ry * 1.15)
    }
    const grout = u(3.5)
    const target = Math.round((chipBudget * formWeight) / totalWeight)
    const chips = pack(
      grit, { x0, y0, x1, y1 }, target, fine, coarse, u(1.2),
      (x, y, r) => focals.some((foc) => {
        const s = Math.max(1, Math.min(foc.rx, foc.ry))
        return foc.norm(x, y) + (r + grout) / s < 1
      }),
      ctx.expired,
    )
    for (const c of chips) subject.push(stone(c, pickTone(grit, onForm), grit, ctx.ramp(0.85)))
  }

  /**
   * The pour spills onto the ground, thinning fast.
   *
   * Bare ground is the negative space this direction is built on, so what
   * lands out here is sparse, small and gathered where the falloff is strong —
   * enough to say the material continues past the shapes, not enough to become
   * a field again.
   */
  {
    const clear = (x: number, y: number) => !slabs.some((s) => inside(s.pts, x, y))
    // spill: the pour throws grit a short way past the stone it came out of,
    // which is what ties a hard-edged slab to the ground it sits on
    const spill = (x: number, y: number) =>
      slabs.some((s) => Math.hypot(x - s.c.x, y - s.c.y) < s.r * 1.45)
    const target = Math.round((chipBudget * 0.26) / totalWeight)
    const chips = pack(
      grit,
      { x0: -short * 0.1, y0: -short * 0.1, x1: w + short * 0.1, y1: h + short * 0.1 },
      target, fine, coarse * 0.55, u(lerp(24, 8, densityK)),
      (x, y) => clear(x, y) &&
        grit.next() < 0.08 + 0.92 * Math.max(ctx.falloff(x, y) ** 1.3, spill(x, y) ? 0.5 : 0),
      ctx.expired,
    )
    for (const c of chips) {
      const side = spans(c.x, c.y, c.r)
      if (side.out) back.push(stone(c, pickTone(grit, onGround), grit, air))
      if (side.in) subject.push(stone(c, pickTone(grit, onForm), grit, ctx.ramp(0.85)))
    }

    /**
     * The seam between the two ground tones is a pour edge too.
     *
     * Without this the paler mass is a flat region with nothing happening in
     * it, which is the difference between negative space and a dead area. The
     * gather is one-sided and gaussian, so it thins off the seam rather than
     * drawing a second line beside it.
     */
    const lip = Math.round(lerp(50, 120, densityK) * q)
    const segs = groundEdge.length / 2 - 1
    for (let i = 0; i < lip && segs > 1; i++) {
      if ((i & 63) === 0 && ctx.expired()) break
      const t = grit.next() * segs
      const k = Math.floor(t) * 2
      const fr = t - Math.floor(t)
      const ax = groundEdge[k] as number
      const ay = groundEdge[k + 1] as number
      const bx = groundEdge[k + 2] as number
      const by = groundEdge[k + 3] as number
      const len = Math.hypot(bx - ax, by - ay) || 1
      const nx = -(by - ay) / len
      const ny = (bx - ax) / len
      const dist = grit.gauss() * u(lerp(14, 40, densityK))
      const x = ax + (bx - ax) * fr + nx * dist
      const y = ay + (by - ay) * fr + ny * dist
      if (!clear(x, y)) continue
      const r = u(grit.range(1.8, 7))
      const side = spans(x, y, r)
      const cut = carve({ x, y, r }, grit)
      if (side.out) back.push(paint(cut, pickTone(grit, onGround), air))
      else if (side.in) subject.push(paint(cut, pickTone(grit, onForm), ctx.ramp(0.85)))
    }

    /**
     * A handful of coarse stones out on the bare ground.
     *
     * They are the rung between a slab and a chip: without them the frame
     * jumps from a shape half its width to grit, and the eye reads two
     * unrelated layers instead of one graded material. Each carries the same
     * printed offset the slabs do, so the whole pour agrees about the light.
     */
    const loose = skel.int(3, 6)
    for (let i = 0; i < loose; i++) {
      const a = skel.range(0, TAU)
      const rad = Math.max(focal.rx, focal.ry) * skel.range(1.15, 2.4)
      const x = focal.cx + Math.cos(a) * rad
      const y = focal.cy + Math.sin(a) * rad
      if (!clear(x, y)) continue
      const r = short * lerp(0.035, 0.082, chipK) * skel.range(0.7, 1.3)
      const cut = carve({ x, y, r }, skel)
      const side = spans(x, y, r)
      if (side.out) {
        back.push(el('path', { d: cut.d, fill: shadowOut, transform: shift(off * 0.4) }))
        back.push(paint(cut, ctx.ramp(lerp(0.36, 0.95, skel.next())), air))
      }
      if (side.in) {
        subject.push(el('path', { d: cut.d, fill: withAlpha(shadowIn, 0.6), transform: shift(off * 0.3) }))
        subject.push(paint(cut, skel.next() < 0.6 ? air : ctx.ramp(0.78), ctx.ramp(0.9)))
      }
    }
  }

  /**
   * The rim as a boundary in the material.
   *
   * Fine chips crowd the silhouette from the outside and stop short of it, so
   * the eye reads a poured edge with a grout line rather than a shape with a
   * tint on it. The gap is gaussian, so the crowd thins outward instead of
   * ending on a second circle.
   */
  {
    const band = Math.round(lerp(70, 170, densityK) * q)
    for (const foc of focals) {
      const seedR = Math.max(foc.rx, foc.ry)
      for (let i = 0; i < band; i++) {
        if ((i & 63) === 0 && ctx.expired()) break
        const a = grit.range(0, TAU)
        const dx = Math.cos(a)
        const dy = Math.sin(a)
        const gap = u(4) + Math.abs(grit.gauss()) * u(lerp(16, 52, densityK))
        const rr = rimRadius(foc, dx, dy, seedR) + gap
        const x = foc.cx + dx * rr
        const y = foc.cy + dy * rr
        const r = u(grit.range(1.8, 6))
        back.push(el('path', {
          d: shape(shard(x, y, r, 4, 0.38, grit, false)),
          fill: withAlpha(pickTone(grit, onGround), grit.range(0.55, 1)),
        }))
      }
    }
  }

  const accent = accentBits.length ? accentBits.join('') : undefined
  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const terrazzoChips: Renderer = {
  id: 'terrazzo-chips',
  name: 'Terrazzo Chips',
  family: 'retro-pop',
  dark: false,
  focals: ['circle', 'ellipse', 'arch', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
