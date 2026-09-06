import { clamp, lerp } from '../../svg'
import { path } from '../../scene/path'
import { node } from '../../scene/types'
import type { Node, SceneGraph } from '../../scene/types'
import type { ParamSchema, RenderContext, Renderer } from '../../types'

/**
 * Arches cut out of a wall, printed rather than lit.
 *
 * The family's direction is graphic: flat colour, hard edges, scale contrast
 * doing the work that light does elsewhere. The version this replaces drew each
 * arch as one solid silhouette with concentric hairlines ruled across it, which
 * is a diagram of an arch rather than an arch — one primitive, one weight, one
 * opacity, and no reason for any of the lines to be where they were.
 *
 * So the mass is inverted. The masonry is the drawn thing and the arch is the
 * hole in it, which is what an arch actually is, and the masonry is built out
 * of individual stones: voussoirs fanning from the arc centre round the head,
 * running-bond courses down the piers, each one a separate flat patch with its
 * own value. That gives the two scales the direction lives on for free — a big
 * silhouette read at arm's length, a coursed texture read up close — and it
 * gives every joint a reason to exist, because a joint is the gap between two
 * stones rather than a line ruled on top of one.
 *
 * Value carries everything. Each stone's tone is its ring's recession, plus how
 * its own face turns toward `ctx.light`, plus how near it is to the one opening
 * that is full of light — and then that continuous number is rounded onto one of
 * eighteen inks, so the frame is printed in a countable number of flat colours
 * rather than in four hundred slightly different ones. Nothing is stroked and
 * nothing is translucent: a printed image is opaque ink, and translucency is
 * also what made the old frames read as compositor accidents.
 *
 * Two consequences of the shared pipeline shape the file and are worth naming.
 *
 * Everything sits in a narrow band of `plane` above 0.86, because that is the
 * threshold at which the vector backend also draws a node unclipped and at full
 * strength — below it a mark is drawn at half strength outside the focal form
 * and at full strength inside it, and the seam is a circle through the middle of
 * the picture. Depth here is carried by value, which is the honest way to carry
 * it in a flat print anyway.
 *
 * And the masonry is asked to cover the focal form. The compositor tints that
 * form behind the field, and with nothing over it the tint arrives as a large
 * flat disc floating in the frame with no relation to the architecture. Painted
 * over, it stops existing. What is left uncovered is sky above the parapet, and
 * that emptiness is the composition's negative space rather than an accident.
 *
 * The forms are quads and polygons, so this family draws through the CPU and
 * vector backends rather than the GPU one; no distance-field leaf expresses a
 * voussoir, and inventing one to keep a flag true would be the tail wagging.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Arch count', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'proportion', label: 'Proportion', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'nesting', label: 'Nesting', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'shadow', label: 'Modelling', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'courses', label: 'Coursing', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'weight', label: 'Joint weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'plan', label: 'Arrangement', type: 'select', options: ['auto', 'row', 'nest', 'stack', 'mirror', 'scatter'], default: 'auto' },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'arch', 'circle', 'diamond', 'ellipse'], default: 'auto' },
]

type Head = 'round' | 'pointed' | 'segmental' | 'horseshoe'

/** An opening, and the ring of masonry that surrounds it. */
type Arch = {
  cx: number
  /** the line the opening springs from; the piers stand on it */
  base: number
  /** width and height OF THE VOID, not of the mass */
  w: number
  h: number
  head: Head
  /** total thickness of masonry around the void */
  band: number
  /** how many concentric orders that thickness is divided into */
  rings: number
  tone: number
  open: boolean
  /** a recessed panel in the wall rather than a way through it */
  blind: boolean
}

/**
 * Where the head starts, and how far round it goes.
 *
 * Every head except the pointed one is one elliptical arc, and `beta` is the
 * angle at which that arc leaves the springing line. Zero is the semicircle a
 * round arch is; a positive angle flattens the arc into a segmental one by
 * pushing its centre below the springing; a negative one carries it past the
 * springing so the head overhangs its own jambs, which is the whole of a
 * horseshoe. One parametrisation for four heads, rather than four cases.
 */
const SPRING: Record<Head, number> = { round: 0.6, pointed: 0.54, segmental: 0.8, horseshoe: 0.54 }
const BETA: Record<Head, number> = { round: 0, pointed: 0, segmental: 0.62, horseshoe: -0.34 }

type SetOut = {
  half: number
  l: number
  r: number
  spring: number
  rise: number
  top: number
  rx: number
  ry: number
  ycen: number
  th0: number
  th1: number
}

function setOut(a: Arch): SetOut {
  const half = a.w / 2
  const sf = SPRING[a.head]
  const spring = a.base - a.h * sf
  const rise = Math.max(1, a.h * (1 - sf))
  const b = BETA[a.head]
  const sb = Math.sin(b)
  const rx = half / Math.cos(b)
  const ry = rise / (1 - sb)
  return {
    half, l: a.cx - half, r: a.cx + half, spring, rise,
    top: a.base - a.h,
    rx, ry, ycen: spring + ry * sb,
    th0: Math.PI - b, th1: b,
  }
}

function quadAt(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, t: number,
): [number, number] {
  const m = 1 - t
  return [m * m * x0 + 2 * m * t * x1 + t * t * x2, m * m * y0 + 2 * m * t * y1 + t * t * y2]
}

/** A point on the intrados, `s` running from the left springing to the right. */
function headPoint(a: Arch, g: SetOut, s: number): [number, number] {
  if (a.head === 'pointed') {
    // two arcs meeting at an apex, which is the whole of gothic
    const k = 0.76
    if (s <= 0.5) return quadAt(g.l, g.spring, g.l, g.spring - g.rise * k, a.cx, g.top, s * 2)
    return quadAt(a.cx, g.top, g.r, g.spring - g.rise * k, g.r, g.spring, (s - 0.5) * 2)
  }
  const th = g.th0 + (g.th1 - g.th0) * s
  return [a.cx + g.rx * Math.cos(th), g.ycen - g.ry * Math.sin(th)]
}

/**
 * The outward normal there, found from the curve rather than from a formula.
 *
 * A voussoir is a stone whose two long faces are radial, so every offset in
 * this file is along this vector. Taking it numerically means the pointed head,
 * whose two quadratics have no common centre, offsets exactly as the elliptical
 * ones do, and the seam at the apex comes out as a keystone joint instead of a
 * special case.
 */
function headNormal(a: Arch, g: SetOut, s: number): [number, number] {
  const e = 0.005
  const p0 = headPoint(a, g, Math.max(0, s - e))
  const p1 = headPoint(a, g, Math.min(1, s + e))
  const tx = p1[0] - p0[0]
  const ty = p1[1] - p0[1]
  const len = Math.hypot(tx, ty) || 1
  let nx = ty / len
  let ny = -tx / len
  const p = headPoint(a, g, s)
  if (nx * (p[0] - a.cx) + ny * (p[1] - g.spring) < 0) {
    nx = -nx
    ny = -ny
  }
  return [nx, ny]
}

/** The void as a closed polygon: up one jamb, over the head, down the other. */
function voidPoly(a: Arch, g: SetOut, steps: number): number[] {
  const pts: number[] = [g.l, a.base]
  for (let i = 0; i <= steps; i++) {
    const p = headPoint(a, g, i / steps)
    pts.push(p[0], p[1])
  }
  pts.push(g.r, a.base)
  return pts
}

/**
 * Half-plane clip, which is how every band in this file is cut.
 *
 * Slicing an opening into steps of light, taking a strip of reveal down one
 * jamb and cutting a reflection into ripples are the same operation on the same
 * polygon, so they are one function. Doing it analytically also means no clip
 * path is declared, no id is namespaced, and nothing downstream has to know the
 * band was ever part of a larger shape.
 */
function clipHalf(pts: readonly number[], nx: number, ny: number, c: number): number[] {
  const out: number[] = []
  const n = pts.length / 2
  if (n < 3) return out
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const ax = pts[2 * i] as number
    const ay = pts[2 * i + 1] as number
    const bx = pts[2 * j] as number
    const by = pts[2 * j + 1] as number
    const da = nx * ax + ny * ay - c
    const db = nx * bx + ny * by - c
    if (da >= 0) out.push(ax, ay)
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db)
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t)
    }
  }
  return out
}

const band = (pts: readonly number[], y0: number, y1: number): number[] =>
  clipHalf(clipHalf(pts, 0, 1, y0), 0, -1, -y1)

const NO_LIGHT = { receives: false, casts: false, emissive: 0 }

function build(ctx: RenderContext): SceneGraph {
  const skel = ctx.fork('skeleton')
  const grit = ctx.fork('stone')
  const { w, h, focal, baseline, light, u } = ctx
  const densityK = ctx.num('density')
  const proportionK = ctx.num('proportion')
  const nestingK = ctx.num('nesting')
  const shadowK = ctx.num('shadow')
  const coursesK = ctx.num('courses')
  const weightK = ctx.num('weight')
  const planChoice = ctx.str('plan')

  const nodes: Node[] = []
  const reach = Math.max(focal.rx, focal.ry)
  let ref = 0

  /**
   * One printed plane, and a very shallow band of it.
   *
   * Depth here is a drawing order, not a distance: the whole picture is ink on
   * one sheet, so `plane` only has to sort. The band is pinned to the top of
   * the range for two reasons beyond the one given at the top of the file.
   * Above 0.9868 the resolved alpha rounds to exactly 1 in the vector output,
   * which is what keeps every mark opaque ink rather than a stack of
   * near-transparent layers — and a few hundred layers of 98% opacity is also
   * what one rasteriser we depend on falls over on. Sorting is stable, so ties
   * inside the band keep the order they were pushed in.
   */
  const at = (z: number) => 0.988 + 0.011 * clamp(z, 0, 1)

  /**
   * The stages, which are the whole of this composition's depth.
   *
   * A stage is a place in the printing order, not a distance from the eye, and
   * the arches share one set of them rather than each carrying its own: they
   * are laid side by side on one wall, so a global order is both correct and
   * what lets every stone of every arch that shares a value be printed as one
   * mark.
   */
  const Z = {
    wall: 0, cope: 1, floor: 2, pool: 3, flag: 4, cast: 5, void: 6, light: 7,
    transom: 8, reveal: 9, stone: 10, plinth: 11, reflect: 12, mirrored: 13,
    ripple: 14, sill: 15,
  }
  const STAGES = 16

  /**
   * A limited set of inks, and every mark in the frame assigned to one of them.
   *
   * Each polygon goes into a bucket keyed by its stage and its value quantised
   * to one of eighteen levels, and a bucket becomes a single node carrying all
   * of its polygons as subpaths. Two things fall out of that and both are the
   * point. The picture is printed in a countable number of flat inks, which is
   * what the direction is asking for and what a continuous per-stone value
   * would have quietly refused; and four hundred stones cost forty nodes rather
   * than four hundred, which is the difference between a frame the shared
   * rasteriser can draw and one it cannot.
   */
  const LEVELS = 18
  type Ink = { z: number; tone: number; parts: number[][] }
  const inks = new Map<number, Ink>()
  let marks = 0

  /**
   * The element budget, spent mostly on stones.
   *
   * Generous, because the per-arch counts below are already bounded and the
   * marks collapse into a few dozen nodes on the way out. It exists to stop a
   * pathological parameter combination, not to shape the picture: a budget that
   * bites mid-composition leaves an arch with a hole and no masonry round it,
   * which is worse than any density it was protecting against.
   */
  const CAP = 2200
  const full = () => marks > CAP

  /**
   * A polygon, unless it has no area.
   *
   * Every band in this file comes out of a half-plane clip, and a clip that
   * misses its shape returns three collinear points. That is a path with a
   * zero-height bounding box, which one rasteriser we depend on treats as a
   * fatal error rather than as nothing to draw, so the degenerate cases are
   * dropped here where they are produced.
   */
  const flat = (pts: readonly number[], z: number, tone: number) => {
    if (pts.length < 6) return
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] as number
      const y = pts[i + 1] as number
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
    // the emitted coordinates round to a tenth of a unit past a hundred, so
    // the floor has to sit above that or a "thin" band lands as a zero-area path
    if (x1 - x0 < 0.4 || y1 - y0 < 0.4) return
    /**
     * And nothing that lands entirely off the field.
     *
     * The layout always zooms enough for the field's own rectangle to cover the
     * frame, so a mark wholly outside it can never be seen — and the vector
     * backend wraps every mark in a group the rasteriser has to size, which it
     * cannot do when the group's whole extent is off-canvas. Invisible geometry
     * is not free; it is the difference between a frame that rasterises and one
     * that does not.
     */
    if (x1 < -w * 0.22 || x0 > w * 1.22 || y1 < -h * 0.22 || y0 > h * 1.22) return
    const level = Math.round(clamp(tone, 0, 1) * (LEVELS - 1))
    const key = z * LEVELS + level
    let ink = inks.get(key)
    if (!ink) {
      ink = { z, tone: level / (LEVELS - 1), parts: [] }
      inks.set(key, ink)
    }
    ink.parts.push(pts.slice() as number[])
    marks += 1
  }

  const rect = (x0: number, y0: number, x1: number, y1: number, z: number, tone: number) => {
    flat([x0, y0, x1, y0, x1, y1, x0, y1], z, tone)
  }

  // --- the arrangement ------------------------------------------------------
  const PLANS = ['row', 'nest', 'stack', 'mirror', 'scatter'] as const
  const plan = PLANS.includes(planChoice as (typeof PLANS)[number])
    ? (planChoice as (typeof PLANS)[number])
    : skel.pick(PLANS)

  const HEADS: readonly Head[] = ['round', 'pointed', 'segmental', 'horseshoe']
  // one head shape for the whole composition; mixing them reads as indecision
  const head = skel.pick(HEADS)
  const ratio = lerp(1.3, 2.5, proportionK) * skel.range(0.94, 1.08)
  const orders = Math.round(lerp(2, 5, nestingK))

  const ground = Math.min(h * 0.88, baseline + reach * 0.34)
  /**
   * Where the arrangement is centred.
   *
   * The layout is free to put the focal form against an edge, and an arcade
   * set out from there hangs half of itself, including its one lit opening,
   * outside the picture. The composition follows the subject but is not
   * allowed to leave with it.
   */
  const axis = clamp(focal.cx, w * 0.38, w * 0.62)
  const arches: Arch[] = []
  let floorY = ground
  let mirrored = false

  const push = (cx: number, base: number, wide: number, thick: number, rings: number, tone: number) => {
    arches.push({
      cx, base, w: Math.max(u(24), wide), h: Math.max(u(30), wide * ratio), head,
      band: Math.max(u(10), thick), rings: Math.max(1, rings), tone, open: false, blind: false,
    })
  }

  switch (plan) {
    case 'row': {
      /**
       * An arcade, with one arch deliberately much larger than the rest.
       *
       * Even bays are a comb. The direction asks for scale contrast, so the
       * count buys bays and one of them is spent on an opening twice the width
       * of its neighbours — that difference is the composition.
       */
      const n = Math.round(lerp(3, 6, densityK))
      const span = w * lerp(1.15, 1.55, densityK)
      const unit = span / n
      // the big bay sits near the middle of the arcade, where the layout put
      // the subject; a random index put it off the edge of the picture
      const hero = clamp(Math.round((n - 1) / 2) - (skel.bool(0.4) ? 1 : 0), 0, n - 1)
      for (let i = 0; i < n; i++) {
        const cx = axis - span / 2 + unit * (i + 0.5)
        const wide = unit * (i === hero ? 0.66 : 0.3) * skel.range(0.94, 1.06)
        push(cx, ground, wide, (unit - wide) * 0.42, i === hero ? orders : Math.max(1, orders - 1),
          i === hero ? 0.5 : 0.4 + 0.1 * skel.next())
      }
      break
    }

    case 'nest': {
      // the name of the style: one portal, its orders stepping back into the
      // wall, the innermost of them the opening the light comes through
      const wide = reach * lerp(0.6, 1.02, proportionK)
      push(axis, ground, wide, reach * lerp(0.55, 1.1, nestingK), orders + 1, 0.5)
      break
    }

    case 'stack': {
      // shrinking and climbing, each standing on the head of the one below
      const n = Math.round(lerp(2, 4, densityK))
      let wide = reach * lerp(0.9, 1.3, proportionK)
      let base = ground
      for (let i = 0; i < n; i++) {
        const thick = wide * lerp(0.3, 0.5, nestingK)
        push(axis + skel.gauss() * reach * 0.1, base, wide, thick, orders, 0.52 - 0.08 * i)
        base -= wide * ratio + thick * 1.1
        wide *= lerp(0.62, 0.78, nestingK)
      }
      break
    }

    case 'mirror': {
      // an arcade standing on a polished floor, which is a different thing
      // from an arch and an upside-down arch stuck together at the waist
      mirrored = true
      const n = Math.round(lerp(2, 3, densityK))
      const span = w * 1.2
      const unit = span / n
      floorY = Math.min(h * 0.76, focal.cy + reach * 0.8)
      for (let i = 0; i < n; i++) {
        const cx = axis - span / 2 + unit * (i + 0.5)
        const wide = unit * skel.range(0.5, 0.62)
        push(cx, floorY, wide, (unit - wide) * 0.4, orders, 0.44 + 0.12 * skel.next())
      }
      break
    }

    default: {
      /**
       * Three scales, stated rather than sampled.
       *
       * A width drawn from a range gives five arches of four similar sizes,
       * which is the one thing a graphic composition cannot afford. Assigning
       * each arch to one of three sizes, and keeping every centre well inside
       * the frame so none arrives as a half-arch sliced off by the edge, is
       * what makes the contrast deliberate.
       */
      const sizes = [reach * 1.25, reach * 0.66, reach * 0.3]
      const n = Math.round(lerp(3, 5, densityK))
      const wides: number[] = []
      for (let i = 0; i < n; i++) wides.push(sizes[i % 3] as number)
      // largest in the middle, then out to the edges, so the packing below puts
      // the scale contrast where the eye lands rather than wherever it fell
      wides.sort((x, y) => y - x)
      const order: number[] = []
      wides.forEach((v, i) => (i % 2 ? order.push(v) : order.unshift(v)))
      const thick = (v: number) => v * lerp(0.22, 0.4, nestingK)
      const outer = order.map((v) => (v + 2 * thick(v)) * 1.08)
      const total = outer.reduce((m, v) => m + v, 0)
      let cursor = axis - total / 2
      for (let i = 0; i < order.length; i++) {
        const wide = order[i] as number
        const cx = cursor + (outer[i] as number) / 2
        cursor += outer[i] as number
        // scattered in height, packed in width: arches at several levels on one
        // wall read as niches, arches crossing each other read as a glitch
        const base = clamp(ground - skel.range(0, 0.22) * h, h * 0.45, ground)
        push(cx, base, wide, thick(wide), orders, 0.38 + 0.16 * skel.next())
      }
    }
  }

  if (arches.length === 0) push(axis, ground, reach * 0.7, reach * 0.4, orders, 0.5)

  /**
   * The composition, brought up to fill the frame.
   *
   * Every plan sets its arches out from the focal radius, and on the layouts
   * that hand out a small one the whole arcade arrived in the bottom third
   * under half a frame of bare sky. Negative space is meant to be a decision;
   * that was arithmetic. So the arches are scaled about the floor until the
   * highest crown reaches the upper third, and no further — an arch that
   * overruns the frame is scale contrast, an arch lost in it is not.
   */
  {
    let crown = h * 3
    for (const a of arches) crown = Math.min(crown, a.base - a.h - a.band)
    const want = h * 0.24
    if (crown > want) {
      const k = clamp((floorY - want) / Math.max(1, floorY - crown), 1, 2.1)
      // the spacing scales with the widths, or the arches grow into each
      // other and an arcade turns into a pile of overlapping rings
      for (const a of arches) {
        a.cx = axis + (a.cx - axis) * k
        a.base = floorY - (floorY - a.base) * k
        a.w *= k
        a.h *= k
        a.band *= k
      }
    }
  }

  /**
   * Arches the frame will never contain at all are dropped.
   *
   * Scaling the arrangement up can carry an outer bay a long way past the edge,
   * and geometry entirely outside the field rectangle is not just wasted — a
   * mark whose whole extent is off-canvas is one of the shapes the shared
   * rasteriser refuses to draw.
   */
  {
    const kept = arches.filter((a) => {
      const half = a.w / 2 + a.band
      return a.cx + half > -w * 0.28 && a.cx - half < w * 1.28
        && a.base - a.h - a.band < h * 1.28
    })
    if (kept.length) {
      arches.length = 0
      arches.push(...kept)
    }
  }

  /**
   * Which opening is the light.
   *
   * The largest — but only among those the frame actually contains. Taking the
   * largest outright put the one lit opening off the edge of the picture on
   * every arcade whose widest bay happened to fall outside, and a composition
   * whose subject is not in it has no subject.
   */
  let openIdx = 0
  let best = -1
  arches.forEach((a, i) => {
    const inside = a.cx > w * 0.15 && a.cx < w * 0.85 ? 1 : 0.04
    const score = a.w * a.h * inside
    if (score > best) {
      best = score
      openIdx = i
    }
  })
  const ap = arches[openIdx] as Arch
  ap.open = true
  ap.tone = Math.max(ap.tone, 0.54)

  /**
   * Light spilling out of the aperture, as a term added to every stone.
   *
   * The alternative is a translucent wash laid over the masonry, and a wash is
   * the one thing this direction forbids — it also loses the coursing under it.
   * Adding the fall-off to each stone's own value instead keeps every patch
   * flat and hard-edged, and the spill arrives as a printed step per stone,
   * which is what a screen-printed glow actually looks like.
   */
  const apOut = setOut(ap)
  const gcx = ap.cx
  const gcy = apOut.spring + apOut.rise * 0.2
  const gr = ap.w * 1.5 + ap.band
  const spill = (x: number, y: number) => {
    const dx = (x - gcx) / gr
    const dy = (y - gcy) / (gr * 1.35)
    return 0.2 * Math.exp(-(dx * dx + dy * dy) * 1.3)
  }

  // --- the wall -------------------------------------------------------------
  /**
   * A wall, cut off at a parapet, with sky above it.
   *
   * It runs past the frame left and right, because an edge that stops inside
   * the picture arrives as the hard vertical cut that made the ground look
   * unfinished. Only a little past, though: the layout picks a zoom that keeps
   * the field's own rectangle covering the frame however far it is turned, so
   * anything drawn well outside that rectangle is geometry nobody will ever
   * see, and a mark whose whole extent is off-canvas is exactly what the
   * shared rasteriser chokes on.
   *
   * It starts above the focal form, because painting over that form is what
   * stops the compositor's tint of it arriving as a flat disc belonging to
   * nothing. What is left above the parapet is sky, and that emptiness is the
   * composition's negative space.
   */
  const FAR0 = -w * 0.3
  const FAR1 = w * 1.3
  let crown = h * 3
  for (const a of arches) crown = Math.min(crown, a.base - a.h - a.band)
  /**
   * A blind arcade under the parapet, and the wall sized to carry it.
   *
   * This is the scale contrast the direction is built on, and it is the one
   * thing the old version had no answer for: every arch in a composition was
   * roughly the size of every other arch. A frieze of small recessed arches
   * running the full width, at a fifth the size of the opening below it, gives
   * the eye a near reading and a far one, and it turns the top of the wall from
   * the place the composition stops into a course of its own. It is also the
   * same form at another size, which is what "nested" means when it is not
   * being literal about concentric rings.
   */
  const friezeH = clamp((ap.h + ap.band) * 0.2, u(34), u(82))
  const frieze = arches.length < 6 && crown - friezeH > h * 0.14
  const friezeFoot = crown - u(14)
  let wallTop = frieze ? friezeFoot - friezeH - u(26) : crown - u(20)
  wallTop = Math.min(wallTop, focal.cy - focal.ry - u(14))
  const WALL = 0.1
  const VOID = 0.02
  const FLOOR = 0.17

  rect(FAR0, wallTop, FAR1, h * 1.3, Z.wall, WALL)

  // a coping and a fillet under it: the parapet gets two weights, so the top
  // edge of the wall is drawn rather than merely where the wall stops
  if (wallTop > -u(60)) {
    rect(FAR0, wallTop, FAR1, wallTop + u(11), Z.cope, WALL + 0.24 + 0.1 * shadowK)
    rect(FAR0, wallTop + u(11), FAR1, wallTop + u(15.5), Z.cope, WALL + 0.02)
  }

  if (frieze) {
    const fw = friezeH * 0.58
    const n = clamp(Math.round((FAR1 - FAR0) / (fw * 2.4)), 5, 13)
    const cell = (FAR1 - FAR0) / n
    // the string course the little arches stand on
    rect(FAR0, friezeFoot, FAR1, friezeFoot + u(6), Z.cope, WALL + 0.16)
    for (let i = 0; i < n; i++) {
      arches.push({
        cx: FAR0 + cell * (i + 0.5), base: friezeFoot, w: fw, h: friezeH, head,
        band: fw * 0.34, rings: 1, tone: WALL + 0.28, open: false, blind: true,
      })
    }
  }

  // Ashlar on the bare wall: one joint every few courses, so the flat ground
  // between the arches carries the same fabric they are built of instead of
  // reading as paper the arches were pasted onto.
  for (let y = wallTop + u(30); y < h * 1.28; y += u(44)) {
    rect(FAR0, y, FAR1, y + u(1.4 + weightK), Z.cope, WALL - 0.05)
  }

  // --- the floor ------------------------------------------------------------
  rect(FAR0, floorY, FAR1, h * 1.3, Z.floor, FLOOR)

  /**
   * The light on the floor, thrown rather than pooled.
   *
   * A soft ellipse under the doorway is what a photograph does. What a print
   * does is cut the beam: three nested wedges spreading from the threshold to
   * the bottom edge, each a step brighter than the one around it, leaning the
   * way the light leans. It also does the composition's other job, which is to
   * give the empty half of the frame below the arcade something to be, and to
   * lead the eye back up the wedge to the opening it came out of.
   */
  {
    const reachY = h * 1.32 - floorY
    const lean = -light.dx * reachY * 0.4
    for (let i = 0; i < 3; i++) {
      const k = 1 - i * 0.3
      const half = ap.w * 0.5 * k
      const spread = ap.w * 0.85 * k
      flat(
        [
          ap.cx - half, floorY, ap.cx + half, floorY,
          ap.cx + half + spread + lean, floorY + reachY,
          ap.cx - half - spread + lean, floorY + reachY,
        ],
        Z.pool, FLOOR + 0.18 + i * 0.14,
      )
    }
  }

  {
    // Flags, as joints rather than as bands: dark lines widening apart toward
    // the eye, drawn over the light so the floor keeps its coursing inside the
    // beam instead of turning into one flat wedge of colour.
    let y = floorY
    let step = u(15)
    for (let i = 0; i < 8 && y < h * 1.25; i++) {
      y += step
      rect(FAR0, y, FAR1, y + u(1.5 + 1.4 * weightK) * (i % 3 === 2 ? 2.2 : 1), Z.flag, FLOOR - 0.06)
      step *= 1.34
    }
  }

  // --- the arches -----------------------------------------------------------
  const amp = 0.09 + 0.2 * shadowK
  const joint = u(2.3 * weightK)

  for (const a of arches) {
    if (ctx.expired() || full()) break
    const g = setOut(a)
    const vp = voidPoly(a, g, 26)
    const outer = a.band
    const rw = outer / a.rings

    // the outside of the whole mass: the intrados pushed out by the full
    // thickness of the orders. Both the cast shadow and the reflection are this
    // shape, which is why it is taken once.
    const silhouette: number[] = [g.l - outer, a.base + u(7)]
    for (let i = 0; i <= 20; i++) {
      const s = i / 20
      const p = headPoint(a, g, s)
      const n = headNormal(a, g, s)
      silhouette.push(p[0] + n[0] * outer, p[1] + n[1] * outer)
    }
    silhouette.push(g.r + outer, a.base + u(7))

    /**
     * The shadow the mass throws on the wall behind it.
     *
     * One offset copy of the silhouette in a darker wall value. A print cannot
     * blur, so the shadow is a shape, and a shape is also the only kind of
     * shadow that survives being reduced to a phone thumbnail.
     */
    if (shadowK > 0.05 && !a.blind) {
      const off = outer * 0.45 * shadowK
      const cast = silhouette.slice()
      for (let i = 0; i < cast.length; i += 2) {
        cast[i] = (cast[i] as number) - light.dx * off
        cast[i + 1] = (cast[i + 1] as number) - light.dy * off
      }
      flat(cast, Z.cast, WALL - 0.055)
    }

    // --- the opening --------------------------------------------------------
    if (a.open) {
      /**
       * Light, in steps, brightest at the head.
       *
       * The old aperture was one flat fill with an accent stroke round it,
       * which is a paper cut-out of a doorway. A ramp of eight or ten bands is
       * still flat colour and still hard-edged, but it has a direction, and
       * the direction is the whole difference between a hole and a light.
       */
      const bands = 7 + Math.round(4 * coursesK)
      for (let i = 0; i < bands; i++) {
        const y0 = lerp(g.top, a.base, i / bands)
        const y1 = lerp(g.top, a.base, (i + 1) / bands)
        flat(band(vp, y0, y1), Z.light, lerp(1, 0.68, (i / (bands - 1)) ** 0.85))
      }
      // two dark transoms across it, which is the second scale inside the light
      for (let i = 1; i <= 2; i++) {
        const y = lerp(g.spring, a.base, i / 3.2)
        flat(band(vp, y, y + u(3.4 + 2 * weightK)), Z.transom, 0.34)
      }
      /**
       * The wall's own thickness, seen down the jamb away from the light.
       *
       * Two steps rather than one. A single strip of flat colour inside the
       * opening is a stripe; splaying it into a near face and a returned one
       * is what makes the opening read as cut through something with depth,
       * and it is the cheapest honest way to say how thick the wall is.
       */
      const side = light.dx >= 0 ? -1 : 1
      const rev = Math.min(a.w * 0.2, outer * 0.42)
      for (let i = 0; i < 2; i++) {
        const cut = rev * (1 - i * 0.45)
        flat(
          side < 0 ? clipHalf(vp, -1, 0, -(g.l + cut)) : clipHalf(vp, 1, 0, g.r - cut),
          Z.reveal, 0.26 + i * 0.16,
        )
      }
    } else {
      // A way through to nothing: the darkest value in the frame after the sky,
      // with one lit inner face so it reads as a hole with thickness rather than
      // as a silhouette. A blind arch is not a way through at all, so its
      // ground is the wall one step sunk instead.
      flat(vp, Z.void, (a.blind ? WALL - 0.055 : VOID) + 0.03 * spill(a.cx, g.spring))
      const side = light.dx >= 0 ? 1 : -1
      const rev = Math.min(a.w * 0.3, outer * 0.45)
      flat(
        side > 0 ? clipHalf(vp, 1, 0, g.r - rev) : clipHalf(vp, -1, 0, -(g.l + rev)),
        Z.reveal,
        (a.blind ? WALL + 0.06 : 0.14) + 0.2 * spill(a.cx, g.spring),
      )
    }

    // --- the archivolt ------------------------------------------------------
    /**
     * Voussoirs, fanning from the arc centre.
     *
     * Each stone is a quad between two radii and two offsets along them, inset
     * by a joint on every side it shares with another stone, so the mortar is
     * the wall showing through rather than a line drawn over it. Its value is
     * its order's recession plus the dot product of its own face with the
     * light, which is what makes the ring turn rather than merely step.
     */
    const arc = Math.PI * (g.rx + g.ry) * 0.5
    const per = Math.max(u(11), arc / lerp(18, 9, coursesK))
    const count = Math.max(5, Math.round(arc / per) | 1)
    for (let k = 0; k < a.rings; k += 1) {
      if (full()) break
      const g0 = k * rw + (k === 0 ? 0 : joint * 0.5)
      const g1 = (k + 1) * rw - joint * 0.5
      const recess = lerp(-0.17, 0.03, (k + 0.5) / a.rings)
      const ds = Math.min(0.4 / count, joint / Math.max(1, arc))
      for (let i = 0; i < count; i++) {
        if (full()) break
        const s0 = i / count + (i === 0 ? 0 : ds)
        const s1 = (i + 1) / count - (i === count - 1 ? 0 : ds)
        const pa = headPoint(a, g, s0)
        const na = headNormal(a, g, s0)
        const pb = headPoint(a, g, s1)
        const nb = headNormal(a, g, s1)
        const mid = headNormal(a, g, (s0 + s1) / 2)
        const face = mid[0] * light.dx + mid[1] * light.dy
        const cx = (pa[0] + pb[0]) / 2 + mid[0] * (g0 + g1) / 2
        const cy = (pa[1] + pb[1]) / 2 + mid[1] * (g0 + g1) / 2
        flat(
          [
            pa[0] + na[0] * g0, pa[1] + na[1] * g0,
            pb[0] + nb[0] * g0, pb[1] + nb[1] * g0,
            pb[0] + nb[0] * g1, pb[1] + nb[1] * g1,
            pa[0] + na[0] * g1, pa[1] + na[1] * g1,
          ],
          Z.stone,
          a.tone + recess + amp * face + spill(cx, cy) + grit.range(-0.05, 0.05),
        )
      }
    }

    // --- the piers ----------------------------------------------------------
    /**
     * Running bond, with the courses aligned to the orders.
     *
     * A stone is one order wide, and every other row is shifted half a stone,
     * so the vertical joints break the way masonry breaks instead of running
     * the full height of the pier as a set of ruled lines. The shift is what
     * costs nothing and reads as built.
     */
    const pierH = a.base - g.spring
    if (pierH > u(8)) {
      const ch = Math.max(u(9), Math.min(rw * 1.35, a.w * lerp(0.3, 0.13, coursesK)))
      const rows = clamp(Math.round(pierH / ch), 2, 14)
      const rh = pierH / rows
      for (let row = 0; row < rows; row++) {
        if (full()) break
        const y0 = a.base - (row + 1) * rh + joint * 0.5
        const y1 = a.base - row * rh - joint * 0.5
        const shift = row % 2 ? rw * 0.5 : 0
        for (const dir of [-1, 1] as const) {
          const edge = dir < 0 ? g.l : g.r
          const face = dir * light.dx
          for (let c = 0; c < a.rings + 1; c++) {
            if (full()) break
            const q0 = c * rw - shift
            const q1 = q0 + rw
            const x0 = Math.max(0, q0)
            const x1 = Math.min(outer, q1)
            if (x1 - x0 < rw * 0.3) continue
            const recess = lerp(-0.17, 0.03, ((x0 + x1) * 0.5) / outer)
            const sx0 = dir < 0 ? edge - x1 : edge + x0
            const sx1 = dir < 0 ? edge - x0 : edge + x1
            rect(
              sx0 + joint * 0.5, y0, sx1 - joint * 0.5, y1,
              Z.stone,
              a.tone + recess + amp * face + spill((sx0 + sx1) / 2, (y0 + y1) / 2)
              + grit.range(-0.05, 0.05),
            )
          }
        }
      }
    }

    // A plinth under everything, which is what stops an arch floating: one
    // heavy horizontal with a lighter overhang on top of it.
    const plinth = a.base
    if (!a.blind) {
      rect(g.l - outer - u(4), plinth, g.r + outer + u(4), plinth + u(9), Z.plinth,
        a.tone + 0.1 + spill(a.cx, plinth))
      rect(g.l - outer - u(6.5), plinth + u(9), g.r + outer + u(6.5), plinth + u(15), Z.plinth,
        a.tone - 0.12 + spill(a.cx, plinth))
    }

    /**
     * The reflection, for the plan that asks for one.
     *
     * An arch mirrored about its springing line is a capsule — a pill standing
     * on end — and that is what the old mirror plan drew. What a reflection
     * actually is: the whole mass upside down, losing value into the floor, and
     * the dark opening upside down inside it, both cut into bands that step
     * sideways as they descend the way a disturbed surface breaks an image.
     * Reflecting only the void was the same mistake in a subtler form — it put
     * the bright part of the arch where the dark part should be.
     */
    if (mirrored && !a.blind && !full()) {
      // stopped at the bottom of the frame: a reflection that runs off past it
      // is bands nobody sees, and a band entirely off-canvas is a shape the
      // shared rasteriser refuses
      const depth = Math.min(a.h * 0.72, Math.max(u(30), h * 1.2 - floorY))
      const steps = 6
      const mirror = (src: readonly number[], shift: number) => {
        const out = src.slice() as number[]
        for (let i = 0; i < out.length; i += 2) {
          out[i] = (out[i] as number) + shift
          out[i + 1] = 2 * floorY - (out[i + 1] as number)
        }
        return out
      }
      for (let i = 0; i < steps; i++) {
        const y0 = floorY + (depth * i) / steps
        const y1 = floorY + (depth * (i + 1)) / steps
        const t = (i / (steps - 1)) ** 0.65
        const shift = Math.sin(i * 1.9) * a.w * 0.03
        flat(band(mirror(silhouette, shift), y0, y1), Z.reflect,
          lerp(a.tone * 0.78, FLOOR + 0.02, t))
        flat(band(mirror(vp, shift), y0, y1), Z.mirrored,
          lerp(VOID + 0.04, FLOOR + 0.02, t))
      }
      for (let i = 1; i <= 2; i++) {
        const y = floorY + depth * (i / 2.6) ** 0.8
        rect(FAR0, y, FAR1, y + u(2.2 + weightK), Z.ripple, FLOOR + 0.13)
      }
    }
  }

  /**
   * The threshold, and the composition's one bright thing.
   *
   * The accent is spent here rather than as an outline round the opening,
   * because an outline is a symbol of a lit doorway and a bar of light lying
   * across its sill is the light itself. It is the only emissive node in the
   * frame, so it is what the bloom and the depth of field both key off.
   */
  {
    const sill = [
      apOut.l - ap.band * 0.35, ap.base - u(4.5),
      apOut.r + ap.band * 0.35, ap.base - u(4.5),
      apOut.r + ap.band * 0.6, ap.base + u(2.5),
      apOut.l - ap.band * 0.6, ap.base + u(2.5),
    ]
    nodes.push(node(
      { k: 'poly', pts: Float64Array.from(sill), closed: true },
      at(Z.sill / (STAGES - 1)),
      { k: 'emissive', intensity: 0.55 },
      0.94,
      {
        weight: 1.1 * weightK, seedRef: (ref += 1),
        light: { receives: false, casts: false, emissive: 1 },
      },
    ))
  }

  // --- printing -------------------------------------------------------------
  // One node per ink, its polygons carried as subpaths. The order is stage
  // first and value second, and within a stage the values are laid on darkest
  // upward, which is how the pool of light on the floor comes out as three
  // rings rather than one flat oval.
  for (const ink of [...inks.values()].sort((p, q) => p.z - q.z || p.tone - q.tone)) {
    const b = path()
    for (const part of ink.parts) {
      b.moveTo(part[0] as number, part[1] as number)
      for (let i = 2; i < part.length; i += 2) b.lineTo(part[i] as number, part[i + 1] as number)
      b.close()
    }
    nodes.push(node(
      { k: 'path', path: b.build() },
      at(ink.z / (STAGES - 1)),
      { k: 'matte', edgeDark: 0 },
      ink.tone,
      { seedRef: (ref += 1), light: NO_LIGHT },
    ))
  }

  return { nodes, warmth: 0.1 }
}

export const nestedArches: Renderer = {
  id: 'nested-arches',
  name: 'Nested Arches',
  family: 'geometric',
  dark: true,
  focals: ['arch', 'circle', 'ellipse', 'diamond'],
  sampler: 'field',
  schema,
  build,
}
