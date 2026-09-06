import { el, f, clamp, lerp } from '../../svg'
import { toward, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A crystal, faceted — not a mosaic of coloured triangles.
 *
 * The previous version took each facet's tone from a noise "pseudo-normal", so
 * neighbours flipped between light and dark at random and the field had no lit
 * side and no shadow side anywhere in it. Nothing bulged, so nothing was a
 * form; it was 2014 low-poly clip-art with a step in facet size printed exactly
 * on the focal silhouette.
 *
 * This builds a real surface first — a smooth dome over the subject plus two
 * scales of terrain — and derives every facet's normal from the height of its
 * three VERTICES. Adjacent facets share vertices, so they tilt together: the
 * dome comes out with a lit flank, a terminator and a shadow flank, and the
 * periphery reads as a shattered plane catching the same light. The subject is
 * legible because it is modelled, not because it is masked.
 *
 * Everything goes into one unclipped layer. The compositor's inside/outside
 * clips were what made the focal edge the most legible shape in the frame, and
 * a single layer also means there are no gaps: near-black is reserved for
 * facets whose normal turns away from the light, so darkness is shadow rather
 * than a missing tile.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'turbulence', label: 'Skew', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.58 },
  { key: 'relief', label: 'Relief', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'outline', label: 'Bevel', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'crack', label: 'Fracture', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'diamond', 'ellipse', 'arch'], default: 'auto' },
]

type Tri = [number, number, number, number, number, number]

type Facet = {
  t: Tri
  cx: number
  cy: number
  /** longest edge, which is also the local scale tier */
  span: number
  /** 0 far outside the form, 1 at its centre — continuous, never a step */
  k: number
  /** dot(surface normal, light) for the plane through the three vertices */
  key: number
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, focals, focal, palette, light, uid } = ctx
  const densityK = ctx.num('density')
  const skew = ctx.num('turbulence')
  const relief = ctx.num('relief')
  const bevelK = ctx.num('outline')
  const crackK = ctx.num('crack')

  const front: string[] = []
  const defs: string[] = []

  // --- the surface ---------------------------------------------------------
  /**
   * A Gaussian bump rather than a hemisphere.
   *
   * A hemisphere has a silhouette, and a silhouette in a height field is a
   * crease: the facets along it turn vertical all at once and print a hard
   * circle — the exact failure this rewrite exists to remove. exp(-q^2) has no
   * edge anywhere, so the transition from subject to ground is a continuous
   * tilt that the eye reads as a dome resting in a plane.
   */
  const reach = Math.max(focal.rx, focal.ry)
  const amp = reach * (0.62 + 0.85 * relief)
  /**
   * The form's own radius is warped by noise before the bump is taken. Without
   * it every quantity derived from the dome — facet size, tone band, the
   * shadow flank — is radially symmetric, and a dozen concentric quantities
   * agreeing on the same circle is how a mask edge reappears without a mask.
   */
  const dome = (x: number, y: number): number => {
    const s = 1 + 0.24 * ctx.fbm(n(x) * 0.0026 + 61, n(y) * 0.0026 + 13, 2)
    let best = 0
    for (const foc of focals) {
      const q = Math.max(0, foc.norm(x, y)) * s
      const b = Math.exp(-1.25 * q * q)
      if (b > best) best = b
    }
    return best
  }
  /**
   * Height, in the same units as x and y so the gradient is a real slope. Two
   * terrain scales under the dome: a broad one that gives the periphery lit and
   * shadowed flanks of its own, and a fine one confined to the subject, which
   * is what stops the dome reading as a smooth ball someone put triangles on.
   */
  const height = (x: number, y: number): number => {
    const nx = n(x)
    const ny = n(y)
    const k = dome(x, y)
    return (
      amp * k +
      amp * 0.55 * ctx.fbm(nx * 0.0015, ny * 0.0015, 3) +
      amp * 0.07 * k * ctx.fbm(nx * 0.0072 + 40, ny * 0.0072 - 25, 2)
    )
  }

  // --- three scale tiers, reached by a continuous shrink --------------------
  /**
   * Facet size is interpolated GEOMETRICALLY between the coarse periphery and
   * the fine core, so half way along the falloff sits at the geometric mean and
   * a mid ring appears without being asked for. Driving it off `dome^1.5` and
   * jittering it with noise means the tiers have no edges: there is no radius
   * at which the facets suddenly get small.
   */
  const outer = u(lerp(380, 215, densityK))
  const core = u(lerp(76, 33, densityK))
  const ratio = core / outer
  const targetAt = (x: number, y: number): number => {
    const k = Math.pow(dome(x, y), 1.5)
    const j = 1 + 0.34 * ctx.fbm(n(x) * 0.0038 + 9, n(y) * 0.0038 - 4, 2)
    return outer * Math.pow(ratio, k) * clamp(j, 0.58, 1.5)
  }

  // start beyond the frame so every shard bleeds off an edge
  const m = ctx.short * 0.14
  const x0 = -m, y0 = -m, x1 = w + m, y1 = h + m
  const seeds: Tri[] = [
    [x0, y0, x1, y0, x0, y1],
    [x1, y0, x1, y1, x0, y1],
  ]

  const CAP = 2200
  const tris: Tri[] = []
  const split = (t: Tri, depth: number): void => {
    const cx = (t[0] + t[2] + t[4]) / 3
    const cy = (t[1] + t[3] + t[5]) / 3
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
    if (bestLen <= targetAt(cx, cy) || depth >= 16 || tris.length >= CAP || ctx.expired()) {
      tris.push(t)
      return
    }
    const kk = 0.5 + skel.range(-0.2, 0.2) * skew
    const mx = lerp(best[0], best[2], kk)
    const my = lerp(best[1], best[3], kk)
    const ox = t[best[4]] as number
    const oy = t[best[4] + 1] as number
    split([best[0], best[1], mx, my, ox, oy], depth + 1)
    split([mx, my, best[2], best[3], ox, oy], depth + 1)
  }
  for (const t of seeds) split(t, 0)

  // --- shading -------------------------------------------------------------
  /**
   * The plane through the three vertex heights, solved directly. A cross
   * product would do it too, but the layout mirrors the field half the time and
   * a sign error there is a composition lit from the wrong side; fitting
   * z = ax + by + c has no orientation in it at all.
   */
  const LZ = 0.62
  const linv = 1 / Math.hypot(1, LZ)
  const lx = light.dx * linv
  const ly = light.dy * linv
  const lz = LZ * linv

  const facets: Facet[] = []
  for (let i = 0; i < tris.length; i++) {
    if ((i & 127) === 0 && ctx.expired()) break
    const t = tris[i] as Tri
    const ax = t[0], ay = t[1], bx = t[2], by = t[3], cx2 = t[4], cy2 = t[5]
    const za = height(ax, ay)
    const zb = height(bx, by)
    const zc = height(cx2, cy2)
    const d1x = bx - ax, d1y = by - ay, dz1 = zb - za
    const d2x = cx2 - ax, d2y = cy2 - ay, dz2 = zc - za
    const det = d1x * d2y - d1y * d2x
    let gx = 0
    let gy = 0
    if (Math.abs(det) > 1e-4) {
      gx = (dz1 * d2y - dz2 * d1y) / det
      gy = (d1x * dz2 - d2x * dz1) / det
    }
    const inv = 1 / Math.hypot(gx, gy, 1)
    const key = clamp((-gx * inv) * lx + (-gy * inv) * ly + inv * lz, 0, 1)
    const cx = (ax + bx + cx2) / 3
    const cy = (ay + by + cy2) / 3
    const span = Math.max(
      Math.hypot(bx - ax, by - ay),
      Math.hypot(cx2 - bx, cy2 - by),
      Math.hypot(ax - cx2, ay - cy2),
    )
    facets.push({ t, cx, cy, span, k: dome(cx, cy), key })
  }

  /**
   * Value hierarchy by region, and it follows the falloff rather than the mask.
   *
   * Outside the form the whole band is squeezed into the bottom of the ramp so
   * the periphery goes quiet; inside it opens to nearly the full range. Because
   * `k` is continuous the two bands cross-fade over the width of the falloff and
   * no circle is ever drawn. `sink` is the other half: facets turned away from
   * the light are pulled toward the ground so the darks are shadow, and the far
   * periphery is pulled a little way after them so the frame edges recede.
   */
  const tones: string[] = []
  const toneAt = (t: number): string => {
    const i = clamp(Math.round(t * 79), 0, 79)
    const hit = tones[i]
    if (hit !== undefined) return hit
    const c = ctx.ramp(i / 79)
    tones[i] = c
    return c
  }
  const sunk = new Map<number, string>()
  const fillFor = (t: number, sink: number): string => {
    const si = clamp(Math.round(sink * 12), 0, 12)
    if (si === 0) return toneAt(t)
    const ti = clamp(Math.round(t * 79), 0, 79)
    const cached = sunk.get(ti * 16 + si)
    if (cached !== undefined) return cached
    const c = toward(palette, toneAt(t), si / 12)
    sunk.set(ti * 16 + si, c)
    return c
  }

  // A hair of inflation closes the antialiasing seams between neighbours, which
  // is what used to let the ground show through as a web of dark hairlines.
  const grow = u(0.55)
  const swell = (t: Tri): Tri => {
    const cx = (t[0] + t[2] + t[4]) / 3
    const cy = (t[1] + t[3] + t[5]) / 3
    const o: number[] = []
    for (let i = 0; i < 6; i += 2) {
      const dx = (t[i] as number) - cx
      const dy = (t[i + 1] as number) - cy
      const len = Math.hypot(dx, dy) || 1
      o.push((t[i] as number) + (dx / len) * grow, (t[i + 1] as number) + (dy / len) * grow)
    }
    return o as unknown as Tri
  }

  const planes: string[] = []
  const chordLit: string[] = []
  const chordDark: string[] = []
  // bevel tiers: three widths of highlight, two of shadow, so edge weight
  // varies with how squarely the crease faces the light
  const bevel: string[][] = [[], [], [], [], []]
  const bigFacet = u(78)

  for (const fa of facets) {
    const t = swell(fa.t)
    const d = `M${f(t[0])} ${f(t[1])}L${f(t[2])} ${f(t[3])}L${f(t[4])} ${f(t[5])}Z`
    const lo = lerp(0.13, 0.26, fa.k)
    const hi = lerp(0.52, 0.97, fa.k)
    const away = smoothstep(0.18, 0.01, fa.key)
    const tone = lerp(lo, hi, Math.pow(fa.key, 0.85))
    // Near-black belongs to the subject's shadow flank and nowhere else. Let
    // the periphery reach it too and every steep patch of far-field terrain
    // arrives as an isolated black triangle, which the eye reads as a missing
    // tile rather than as shade.
    const sink = clamp(away * (0.16 + 0.46 * fa.k) + (1 - fa.k) * 0.14, 0, 0.64)
    front.push(el('path', { d, fill: fillFor(tone, sink) }))

    /**
     * Second scale, inside the large facets: a wash along the light so each
     * plane has a direction of its own, and a pair of chords standing in for
     * the internal fracture planes of a piece of glass. Both ride the facet's
     * own geometry, which is the difference between texture and sprinkled dots.
     */
    if (fa.span > bigFacet) {
      planes.push(el('path', { d, fill: `url(#${uid}-plane)` }))
      // One chord, not three: the altitude onto the longest edge, which is the
      // plane a shard of this shape would actually part along. Three of them
      // met at the centroid and drew a little star in every large facet.
      let e = 0
      let best = -1
      for (let i = 0; i < 6; i += 2) {
        const len = Math.hypot(
          (fa.t[(i + 2) % 6] as number) - (fa.t[i] as number),
          (fa.t[(i + 3) % 6] as number) - (fa.t[i + 1] as number),
        )
        if (len > best) { best = len; e = (i + 4) % 6 }
      }
      const vx = fa.t[e] as number
      const vy = fa.t[e + 1] as number
      const ox = ((fa.t[(e + 2) % 6] as number) + (fa.t[(e + 4) % 6] as number)) / 2
      const oy = ((fa.t[(e + 3) % 6] as number) + (fa.t[(e + 5) % 6] as number)) / 2
      const line =
        `M${f(lerp(vx, ox, 0.26))} ${f(lerp(vy, oy, 0.26))}` +
        `L${f(lerp(vx, ox, 0.86))} ${f(lerp(vy, oy, 0.86))}`
      if (fa.key > 0.5) chordLit.push(line)
      else chordDark.push(line)
    }

    // --- bevels, in place of an outline ------------------------------------
    /**
     * The old pass stroked every facet with the same misregistered hairline, so
     * every edge in the frame had the same weight and the whole thing read as a
     * printing error. A crease has thickness instead: the edges of a facet that
     * face the light take a bright rim inset just inside them, the edges that
     * face away take a narrower dark one, and edges seen side-on take nothing.
     * Two neighbours therefore meet as a light line against a dark one.
     */
    if (bevelK > 0.02) {
      const present = 0.35 + 0.65 * fa.k
      for (let e = 0; e < 6; e += 2) {
        const ax = fa.t[e] as number
        const ay = fa.t[e + 1] as number
        const bx = fa.t[(e + 2) % 6] as number
        const by = fa.t[(e + 3) % 6] as number
        let ox = by - ay
        let oy = -(bx - ax)
        const olen = Math.hypot(ox, oy) || 1
        ox /= olen
        oy /= olen
        // point it away from the centroid, so "outward" really is outward
        if (((ax + bx) / 2 - fa.cx) * ox + ((ay + by) / 2 - fa.cy) * oy < 0) {
          ox = -ox
          oy = -oy
        }
        const beam = (ox * light.dx + oy * light.dy) * present * (0.45 + bevelK)
        let tier = -1
        let width = 0
        if (beam > 0.6) { tier = 0; width = u(1.5) }
        else if (beam > 0.4) { tier = 1; width = u(0.95) }
        else if (beam > 0.24) { tier = 2; width = u(0.5) }
        else if (beam < -0.52) { tier = 3; width = u(1.15) }
        else if (beam < -0.3) { tier = 4; width = u(0.6) }
        if (tier < 0) continue
        const inset = width * 0.5
        const px0 = ax - ox * inset
        const py0 = ay - oy * inset
        const px1 = bx - ox * inset
        const py1 = by - oy * inset
        bevel[tier]?.push(
          `M${f(lerp(px0, px1, 0.07))} ${f(lerp(py0, py1, 0.07))}` +
          `L${f(lerp(px0, px1, 0.93))} ${f(lerp(py0, py1, 0.93))}`,
        )
      }
    }
  }

  /**
   * One gradient serves every plane: the light direction is constant across the
   * composition, so a bounding-box gradient laid along it gives each facet the
   * same subtle ramp from its shadowed corner to its lit one. Per-facet
   * gradients would have been one def per triangle.
   */
  defs.push(el('linearGradient',
    {
      id: `${uid}-plane`,
      x1: 0.5 - light.dx * 0.62, y1: 0.5 - light.dy * 0.62,
      x2: 0.5 + light.dx * 0.62, y2: 0.5 + light.dy * 0.62,
    },
    el('stop', { offset: '0', 'stop-color': ctx.ramp(0), 'stop-opacity': '0.22' }) +
    el('stop', { offset: '0.5', 'stop-color': ctx.ramp(0), 'stop-opacity': '0' }) +
    el('stop', { offset: '0.5', 'stop-color': ctx.ramp(1), 'stop-opacity': '0' }) +
    el('stop', { offset: '1', 'stop-color': ctx.ramp(1), 'stop-opacity': '0.15' })))

  if (planes.length) front.push(...planes)
  if (chordDark.length) {
    front.push(el('path', {
      d: chordDark.join(''), fill: 'none',
      stroke: withAlpha(toward(palette, ctx.ramp(0), 0.9), 0.4), 'stroke-width': u(0.5),
    }))
  }
  if (chordLit.length) {
    front.push(el('path', {
      d: chordLit.join(''), fill: 'none',
      stroke: withAlpha(ctx.ramp(1), 0.09), 'stroke-width': u(0.45),
    }))
  }

  // The dark half is mixed toward the ground rather than taken from the bottom
  // of the ramp: `ramp(0)` is the least CONTRAST against the ground, which on a
  // dark palette is still lighter than a shadowed facet.
  const creaseDark = toward(palette, ctx.ramp(0), 0.8)
  const bevelPaint: Array<[string, number, number]> = [
    [ctx.ramp(1), u(1.5), 0.38],
    [ctx.ramp(1), u(0.95), 0.24],
    [ctx.ramp(1), u(0.5), 0.12],
    [creaseDark, u(1.15), 0.4],
    [creaseDark, u(0.6), 0.22],
  ]
  for (let i = 0; i < bevel.length; i++) {
    const list = bevel[i] as string[]
    if (!list.length) continue
    const paint = bevelPaint[i] as [string, number, number]
    front.push(el('path', {
      d: list.join(''), fill: 'none',
      stroke: withAlpha(paint[0], paint[2]), 'stroke-width': paint[1],
      'stroke-linecap': 'butt',
    }))
  }

  // --- the fracture --------------------------------------------------------
  /**
   * A crack, not a ruled line. It walks the lattice — each step lands on the
   * nearest real vertex — so it runs along facet edges the way a break in glass
   * does, and it tapers to nothing at both ends in the stroke paint rather than
   * stopping dead in mid-frame. A highlight offset toward the light on one side
   * gives it a lip, which is what makes it read as an opening rather than as a
   * line somebody drew.
   */
  if (crackK > 0.05 && facets.length > 8) {
    const cell = u(120)
    const cols = Math.ceil((w + 2 * m) / cell) + 4
    const bucket = new Map<number, number[]>()
    const bkey = (gx: number, gy: number) => (gy + 4) * cols + (gx + 4)
    for (const fa of facets) {
      for (let e = 0; e < 6; e += 2) {
        const vx = fa.t[e] as number
        const vy = fa.t[e + 1] as number
        const kk = bkey(Math.floor((vx + m) / cell), Math.floor((vy + m) / cell))
        const list = bucket.get(kk)
        if (list) list.push(vx, vy)
        else bucket.set(kk, [vx, vy])
      }
    }
    const snap = (x: number, y: number, r: number): [number, number] | null => {
      const gx = Math.floor((x + m) / cell)
      const gy = Math.floor((y + m) / cell)
      let bestD = r * r
      let out: [number, number] | null = null
      for (let ax = -1; ax <= 1; ax++) {
        for (let ay = -1; ay <= 1; ay++) {
          const list = bucket.get(bkey(gx + ax, gy + ay))
          if (!list) continue
          for (let i = 0; i < list.length; i += 2) {
            const vx = list[i] as number
            const vy = list[i + 1] as number
            const dd = (vx - x) ** 2 + (vy - y) ** 2
            if (dd < bestD) { bestD = dd; out = [vx, vy] }
          }
        }
      }
      return out
    }

    // enter from one side of the subject, cross it, leave by the other
    let head = light.angle + Math.PI * 0.5 + skel.range(-0.55, 0.55)
    let px = focal.cx - Math.cos(head) * (reach * 1.1 + ctx.short * 0.12)
    let py = focal.cy - Math.sin(head) * (reach * 1.1 + ctx.short * 0.12)
    const pts: number[] = [px, py]
    for (let i = 0; i < 130; i++) {
      if ((i & 15) === 0 && ctx.expired()) break
      const step = targetAt(px, py)
      head += skel.range(-1, 1) * (0.34 + 0.55 * skew)
      px += Math.cos(head) * step * 1.15
      py += Math.sin(head) * step * 1.15
      const v = snap(px, py, step * 0.72)
      if (v) { px = v[0]; py = v[1] }
      pts.push(px, py)
      if (px < -m || px > w + m || py < -m || py > h + m) break
    }

    if (pts.length >= 6) {
      let d = `M${f(pts[0] as number)} ${f(pts[1] as number)}`
      let lift = `M${f((pts[0] as number) + light.dx * u(1.4))} ${f((pts[1] as number) + light.dy * u(1.4))}`
      for (let i = 2; i < pts.length; i += 2) {
        d += `L${f(pts[i] as number)} ${f(pts[i + 1] as number)}`
        lift += `L${f((pts[i] as number) + light.dx * u(1.4))} ${f((pts[i + 1] as number) + light.dy * u(1.4))}`
      }
      const ex = pts[pts.length - 2] as number
      const ey = pts[pts.length - 1] as number
      const dark = toward(palette, ctx.ramp(0), 0.85)
      defs.push(el('linearGradient',
        { id: `${uid}-crack`, gradientUnits: 'userSpaceOnUse', x1: pts[0], y1: pts[1], x2: ex, y2: ey },
        el('stop', { offset: '0', 'stop-color': dark, 'stop-opacity': '0' }) +
        el('stop', { offset: '0.32', 'stop-color': dark, 'stop-opacity': (0.72 * crackK).toFixed(3) }) +
        el('stop', { offset: '0.68', 'stop-color': dark, 'stop-opacity': (0.72 * crackK).toFixed(3) }) +
        el('stop', { offset: '1', 'stop-color': dark, 'stop-opacity': '0' })))
      defs.push(el('linearGradient',
        { id: `${uid}-crack-lip`, gradientUnits: 'userSpaceOnUse', x1: pts[0], y1: pts[1], x2: ex, y2: ey },
        el('stop', { offset: '0', 'stop-color': ctx.ramp(1), 'stop-opacity': '0' }) +
        el('stop', { offset: '0.45', 'stop-color': ctx.ramp(1), 'stop-opacity': (0.34 * crackK).toFixed(3) }) +
        el('stop', { offset: '1', 'stop-color': ctx.ramp(1), 'stop-opacity': '0' })))
      front.push(el('path', {
        d, fill: 'none', stroke: `url(#${uid}-crack)`,
        'stroke-width': u(2.6), 'stroke-linejoin': 'round', 'stroke-linecap': 'butt',
      }))
      front.push(el('path', {
        d: lift, fill: 'none', stroke: `url(#${uid}-crack-lip)`,
        'stroke-width': u(0.9), 'stroke-linejoin': 'round', 'stroke-linecap': 'butt',
      }))
    }
  }

  // --- the accent: a specular cluster, not a lone bright triangle -----------
  /**
   * The brief calls out a single saturated chip dropped on a composition, which
   * is precisely what the old orange triangle was. A specular hit is a group:
   * the few facets nearest the lit pole of the dome, each ramped from the
   * accent into the top of the ramp along the light, with a soft halo under
   * them that leaks the colour onto their neighbours.
   */
  const poleX = focal.cx + light.dx * focal.rx * 0.5
  const poleY = focal.cy + light.dy * focal.ry * 0.5
  const near: Array<{ fa: Facet; d: number }> = []
  const WANT = 6
  for (const fa of facets) {
    if (fa.k < 0.42 || fa.key < 0.48 || fa.span > u(105)) continue
    const dd = Math.hypot(fa.cx - poleX, fa.cy - poleY)
    if (near.length < WANT) { near.push({ fa, d: dd }); near.sort((a, b) => a.d - b.d) }
    else if (dd < (near[WANT - 1] as { d: number }).d) {
      near[WANT - 1] = { fa, d: dd }
      near.sort((a, b) => a.d - b.d)
    }
  }
  if (!near.length && facets.length) {
    let bestFa = facets[0] as Facet
    let bestD = Infinity
    for (const fa of facets) {
      const dd = Math.hypot(fa.cx - poleX, fa.cy - poleY)
      if (dd < bestD) { bestD = dd; bestFa = fa }
    }
    near.push({ fa: bestFa, d: bestD })
  }

  let accent: string | undefined
  if (near.length) {
    let gx = 0
    let gy = 0
    for (const c of near) { gx += c.fa.cx; gy += c.fa.cy }
    gx /= near.length
    gy /= near.length
    // The halo is sized off the form, not off the cluster: tied to the cluster
    // it grew whenever the facets there happened to be coarse, and a small
    // subject came out with a glow bigger than itself.
    const halo = clamp(reach * 0.5, u(42), u(105))
    defs.push(el('radialGradient',
      { id: `${uid}-spark`, gradientUnits: 'userSpaceOnUse', cx: gx, cy: gy, r: halo },
      el('stop', { offset: '0', 'stop-color': palette.accent, 'stop-opacity': '0.2' }) +
      el('stop', { offset: '0.5', 'stop-color': palette.accent, 'stop-opacity': '0.075' }) +
      el('stop', { offset: '1', 'stop-color': palette.accent, 'stop-opacity': '0' })))
    defs.push(el('linearGradient',
      {
        id: `${uid}-spec`,
        x1: 0.5 - light.dx * 0.6, y1: 0.5 - light.dy * 0.6,
        x2: 0.5 + light.dx * 0.6, y2: 0.5 + light.dy * 0.6,
      },
      el('stop', { offset: '0', 'stop-color': palette.accent }) +
      el('stop', { offset: '1', 'stop-color': ctx.ramp(1) })))
    let cluster = el('circle', { cx: gx, cy: gy, r: halo, fill: `url(#${uid}-spark)` })
    // The outer members of the cluster are held back, so the hit has a core and
    // a falling edge rather than one hard-edged chip of saturated colour.
    for (let i = 0; i < near.length; i++) {
      const c = near[i] as { fa: Facet }
      const t = swell(c.fa.t)
      cluster += el('path', {
        d: `M${f(t[0])} ${f(t[1])}L${f(t[2])} ${f(t[3])}L${f(t[4])} ${f(t[5])}Z`,
        fill: `url(#${uid}-spec)`,
        opacity: (lerp(0.95, 0.3, i / Math.max(1, near.length - 1)) * (0.55 + 0.45 * c.fa.key)).toFixed(3),
      })
    }
    accent = cluster
  }

  const scene: Scene = { back: [], behind: [], subject: [], front, defs }
  if (accent) scene.accent = accent
  return scene
}

export const lowPolyShards: Renderer = {
  id: 'low-poly-shards',
  name: 'Low-Poly Shards',
  family: 'geometric',
  dark: true,
  focals: ['circle', 'diamond', 'ellipse', 'arch'],
  sampler: 'field',
  schema,
  render,
}
