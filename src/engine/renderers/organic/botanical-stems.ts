import { clamp, el, f, lerp, poly } from '../../svg'
import { lit } from '../../sampling'
import { mixHex, toward, withAlpha } from '../../palette'
import type { Rng } from '../../rng'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A clump of stems found in a lot of empty ground.
 *
 * The quiet direction is the whole brief here, and the previous version fought
 * it: stems evenly spaced across the full width, all the same height, all
 * ruler-straight, which is a wallpaper strip rather than a subject. Plants do
 * not grow like that. They grow where a seed happened to land, so the frame is
 * built as one gaussian clump around the focal centre with a couple of thin
 * satellites, and more than half the ground is left bare.
 *
 * Three things carry the craft, and each of them replaces a primitive that was
 * doing the same job badly.
 *
 * A stem is a tapered fill, not a stroke. A stroke has exactly one width, so a
 * stroked stem is a wire that weighs the same at the tip as at the root. This
 * one is a closed polygon from u(3) at the ground to u(0.8) at the tip, with a
 * narrower lit ridge laid along the side facing the light, so it reads as a
 * cylinder in a light rather than as a line.
 *
 * A leaf is one closed lanceolate blade with asymmetric halves and a curved
 * midrib, not two mirrored quadratics meeting at a straight rib — that pairing
 * is what printed a herringbone up every stem. The blades vary in length,
 * angle and roll, and one in six is turned edge-on to the viewer, which is the
 * cheapest possible evidence that they are surfaces in space.
 *
 * And they are lit individually. Each blade's normal is perpendicular to its
 * own axis, on whichever side it curls to, so `lit()` gives a different value
 * for every leaf on the plant. That value picks one of five radial gradients
 * whose centre is pushed toward the light, so the bright part of a blade is on
 * the light's side of it and a blade turned away is dark all over.
 *
 * Depth is three genuinely different passes rather than one design drawn three
 * times: a soft mass of simplified foliage in the haze, the clump itself sorted
 * front to back with the far third softened, and one oversized near stem cut
 * dark across a corner.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'turbulence', label: 'Sway', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'leaf', label: 'Leaf size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'depth', label: 'Depth of field', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'pollen', label: 'Pollen', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'spread', label: 'Clump spread', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.42 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'arch', 'circle', 'ellipse'], default: 'auto' },
]

/** How many lit-ness buckets the leaf gradients are quantised into. */
const BANDS = 5

const band = (v: number) =>
  Math.max(0, Math.min(BANDS - 1, Math.round(v * (BANDS - 1))))

/**
 * A polyline turned into a closed shape that loses width along its length.
 *
 * Walking out on one side and back on the other is the only way to get a taper
 * out of SVG, which has no variable-width stroke; the payoff is that the root
 * can be four times the tip without any stack of overlapping sub-strokes.
 */
function taper(pts: readonly number[], rootW: number, tipW: number): string {
  const n = pts.length / 2
  if (n < 2) return ''
  const left: number[] = []
  const right: number[] = []
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2] as number
    const y = pts[i * 2 + 1] as number
    const a = Math.max(0, i - 1)
    const b = Math.min(n - 1, i + 1)
    const tx = (pts[b * 2] as number) - (pts[a * 2] as number)
    const ty = (pts[b * 2 + 1] as number) - (pts[a * 2 + 1] as number)
    const m = Math.hypot(tx, ty) || 1
    const hw = lerp(rootW, tipW, i / (n - 1)) * 0.5
    const nx = (-ty / m) * hw
    const ny = (tx / m) * hw
    left.push(x + nx, y + ny)
    right.unshift(x - nx, y - ny)
  }
  return poly([...left, ...right], true)
}

/**
 * One closed blade: a pointed tip, two halves of different width, and a midrib
 * that curves. `asym` is what stops it reading as a symbol — a real leaf is
 * seen at an angle, so the far half is foreshortened.
 */
function blade(
  bx: number, by: number, len: number, wide: number,
  angle: number, asym: number, curl: number,
): string {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const px = -dy
  const py = dx
  const at = (t: number, o: number) =>
    `${f(bx + dx * len * t + px * o)} ${f(by + dy * len * t + py * o)}`
  const bend = curl * len * 0.15
  return (
    `M${at(0, 0)}` +
    `C${at(0.14, wide * 0.72)},${at(0.6, wide)},${at(1, bend)}` +
    `C${at(0.6, bend * 1.6 - wide * asym)},${at(0.14, -wide * asym * 0.72)},${at(0, 0)}Z`
  )
}

/** The midrib, drawn as the curve the blade was built around. */
function rib(
  bx: number, by: number, len: number, angle: number, curl: number,
): string {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const px = -dy
  const py = dx
  const at = (t: number, o: number) =>
    `${f(bx + dx * len * t + px * o)} ${f(by + dy * len * t + py * o)}`
  const bend = curl * len * 0.15
  return `M${at(0.04, 0)}Q${at(0.55, bend * 0.45)} ${at(0.94, bend * 0.94)}`
}

type Look = {
  /** 0 lost in the haze, 1 pressed against the lens */
  z: number
  scale: number
  tone: string
  alpha: number
  /** the haze pass drops ribs, casts and stipple: under that blur they are noise */
  detail: boolean
  /**
   * The accent plant. Its leaves take a tint and its stem takes the accent
   * gradient, so the accent arrives up a whole plant rather than landing on the
   * frame as a lone bright dot.
   */
  tinted: boolean
  head: 'umbel' | 'spike' | 'none'
}

type Spec = {
  rootX: number
  rootY: number
  height: number
  nodes: number
  leafLen: number
  sway: number
  weightK: number
  /** a deliberate lean, as a fraction of height, on top of whatever the sway does */
  tilt: number
  look: Look
}

type Grown = { marks: string; pts: number[]; tipA: number; headR: number }

function grow(ctx: RenderContext, skel: Rng, s: Spec): Grown {
  const { u, n, uid, light, palette } = ctx
  const { look } = s
  const segs = 15

  /**
   * The stem leans with the sway and bows toward the light, and the bow grows
   * as the square of the height — which is what phototropism actually looks
   * like: the young tip does nearly all of the turning while the woody base
   * stays where it germinated.
   */
  const lean = ctx.fbm(n(s.rootX) * 0.004, 61, 3) * s.sway
  const bowDir = light.dx >= 0 ? 1 : -1
  const bow = skel.range(0.09, 0.26) * (0.45 + 0.55 * Math.abs(light.dx)) *
    (0.35 + 0.9 * s.sway)

  const pts: number[] = []
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const drift = ctx.fbm(n(s.rootX) * 0.004 + t * 1.3, 61, 2) * s.height * 0.05 * s.sway
    pts.push(
      s.rootX + (lean * 0.17 + s.tilt) * s.height * t +
        bowDir * bow * s.height * t * t + drift * t,
      s.rootY - s.height * t,
    )
  }

  const marks: string[] = []
  const rootW = u(3 * s.weightK) * look.scale
  const tipW = u(0.8 * s.weightK) * look.scale
  const shaded = mixHex(look.tone, palette.ink, 0.52)

  marks.push(
    el('path', { d: taper(pts, rootW, tipW), fill: shaded }),
    // the lit ridge: a narrower taper slid along the light's side of the stem,
    // which is the whole difference between a cylinder and a line
    el('path', {
      d: taper(pts, rootW * (look.tinted ? 0.6 : 0.44), tipW * 0.6),
      fill: look.tinted ? `url(#${uid}-stalk)` : look.tone,
      transform: `translate(${f(light.dx * rootW * 0.3)} 0)`,
    }),
  )

  const fill = (l: number) => `url(#${uid}-${look.tinted ? 'af' : 'lf'}${band(l)})`

  for (let k = 0; k < s.nodes; k++) {
    const t = 0.15 + 0.79 * ((k + 0.5) / s.nodes)
    const i = Math.min(segs, Math.max(1, Math.round(t * segs)))
    const bx = pts[i * 2] as number
    const by = pts[i * 2 + 1] as number
    const ax = (pts[Math.min(segs, i + 1) * 2] as number) - (pts[(i - 1) * 2] as number)
    const ay = (pts[Math.min(segs, i + 1) * 2 + 1] as number) - (pts[(i - 1) * 2 + 1] as number)
    const stemA = Math.atan2(ay, ax)

    // alternating, but never a matched pair: paired leaves at one angle are
    // exactly what printed a herringbone up the old stems
    const side = (k & 1) === 0 ? 1 : -1
    const spread = lerp(1.3, 0.5, t) + skel.range(-0.4, 0.4)
    const angle = stemA + side * spread
    // big at the base, small at the tip, and not on a straight line between
    const len = s.leafLen * (0.3 + 0.7 * (1 - t) ** 1.35) * skel.range(0.7, 1.35)
    if (len < u(1.5)) continue

    const roll = skel.next()
    const edgeOn = roll < 0.16
    const folded = !edgeOn && roll < 0.28
    const curl = skel.range(-1, 1)
    const wide = len * (edgeOn ? skel.range(0.03, 0.06) : skel.range(0.16, 0.3))
    const asym = edgeOn ? 1 : skel.range(0.45, 0.95)

    // the blade's normal is perpendicular to its own axis, on the side it
    // curls to, so no two leaves on a plant take the same value
    const normal = angle + (curl >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5)
    let l = lit(ctx, normal)
    if (folded) l *= 0.3
    if (edgeOn) l = 0.25 + 0.45 * l

    // the short dark seat where a leaf meets the stem
    if (look.detail && len > u(7)) {
      marks.push(el('path', {
        d: `M${f(bx)} ${f(by)}L${f(bx + Math.cos(angle) * len * 0.3)} ` +
          `${f(by + Math.sin(angle) * len * 0.3)}`,
        stroke: withAlpha(palette.ink, 0.2), 'stroke-width': u(1.5) * look.scale,
        fill: 'none', 'stroke-linecap': 'round',
      }))
    }

    marks.push(el('path', {
      d: blade(bx, by, len, wide, angle, asym, curl),
      fill: fill(l), opacity: look.alpha * skel.range(0.82, 1),
    }))

    if (look.detail && len > u(9) && !edgeOn) {
      marks.push(el('path', {
        d: rib(bx, by, len, angle, curl),
        stroke: withAlpha(ctx.ramp(folded ? 0.55 : 0.95), 0.12 + 0.28 * l),
        'stroke-width': u(0.7) * look.scale, fill: 'none', 'stroke-linecap': 'round',
      }))
    }
  }

  const tipX = pts[segs * 2] as number
  const tipY = pts[segs * 2 + 1] as number
  const tipA = Math.atan2(
    tipY - (pts[(segs - 2) * 2 + 1] as number),
    tipX - (pts[(segs - 2) * 2] as number),
  )
  const headR = u(lerp(4, 10, s.leafLen / Math.max(1, ctx.short * 0.1))) * look.scale

  /**
   * Two kinds of head, both built from many small marks.
   *
   * One sphere with a highlight dot on top of every stem was the single most
   * mechanical thing in the old version — a field of identical lamps. An umbel
   * is a spray of florets at different radii, each lit by the direction it
   * happens to sit in; a spike is a soft lens with seed stippled down its lit
   * side. Plenty of stems carry neither, because plenty of stems are shoots.
   */
  if (s.look.head === 'umbel') {
    const rays = skel.int(5, 9)
    const reach = u(skel.range(5, 12)) * look.scale
    for (let i = 0; i < rays; i++) {
      const a = tipA + skel.range(-1.2, 1.2)
      const d = reach * skel.range(0.45, 1)
      const fx = tipX + Math.cos(a) * d
      const fy = tipY + Math.sin(a) * d
      const r = u(skel.range(1, 2.6)) * look.scale
      if (look.detail) {
        marks.push(el('path', {
          d: `M${f(tipX)} ${f(tipY)}L${f(fx)} ${f(fy)}`, fill: 'none',
          stroke: withAlpha(shaded, 0.7), 'stroke-width': u(0.6) * look.scale,
        }))
      }
      marks.push(el('circle', {
        cx: fx, cy: fy, r, fill: fill(lit(ctx, a)), opacity: look.alpha,
      }))
    }
  } else if (s.look.head === 'spike') {
    const len = u(skel.range(15, 32)) * look.scale
    const wide = u(skel.range(2.4, 5)) * look.scale
    marks.push(el('path', {
      d: blade(tipX, tipY, len, wide, tipA, 1, skel.range(-0.4, 0.4)),
      fill: fill(lit(ctx, tipA + Math.PI * 0.5) * 0.6 + 0.2), opacity: look.alpha,
    }))
    if (look.detail) {
      const seeds = skel.int(7, 14)
      for (let i = 0; i < seeds; i++) {
        const t = skel.range(0.1, 0.95)
        const o = skel.range(-0.5, 0.9) * wide
        marks.push(el('circle', {
          cx: tipX + Math.cos(tipA) * len * t - Math.sin(tipA) * o,
          cy: tipY + Math.sin(tipA) * len * t + Math.cos(tipA) * o,
          r: u(skel.range(0.5, 1.3)) * look.scale,
          fill: withAlpha(ctx.ramp(0.9), 0.3 + 0.3 * skel.next()),
        }))
      }
    }
  }

  return { marks: marks.join(''), pts, tipA, headR }
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, focal, palette, light, uid, short } = ctx
  const densityK = ctx.num('density')
  const sway = ctx.num('turbulence')
  const leafK = ctx.num('leaf')
  const depthK = ctx.num('depth')
  const pollenK = ctx.num('pollen')
  const weightK = ctx.num('weight')
  const spreadK = ctx.num('spread')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  // --- defs ----------------------------------------------------------------
  /**
   * Three depths of blur, one filter region each.
   *
   * The regions are absolute rather than a percentage of each group's bounding
   * box, and that is not fussiness. A clump is a tall narrow bbox, so a box
   * relative padding of a few percent is a couple of pixels wide while the blur
   * reaches ten times that — and a blur cut off by its own filter region does
   * not fade, it stops dead on a straight line down the frame. One region per
   * group means the cost is fixed however many plants land in it.
   */
  const region = {
    filterUnits: 'userSpaceOnUse',
    x: -w * 0.25, y: -h * 0.25, width: w * 1.5, height: h * 1.5,
    'color-interpolation-filters': 'sRGB',
  }
  defs.push(
    el('filter', { ...region, id: `${uid}-haze` },
      el('feGaussianBlur', { stdDeviation: u(lerp(2, 11, depthK)) })),
    el('filter', { ...region, id: `${uid}-mid` },
      el('feGaussianBlur', { stdDeviation: u(lerp(0.4, 3.2, depthK)) })),
    el('filter', { ...region, id: `${uid}-fore` },
      el('feGaussianBlur', { stdDeviation: u(lerp(3, 20, depthK)) })),
  )

  /**
   * The leaf bank.
   *
   * One gradient per leaf would be three hundred gradients, and one gradient
   * for all of them is what made every blade take the same two flat tones no
   * matter which way it faced. Five is enough: the centre is offset toward the
   * light in the blade's own box, so the bright part of a leaf is always on the
   * light's side of it, and which of the five it gets is decided by its own
   * normal.
   */
  const gx = f(0.5 + 0.32 * light.dx)
  const gy = f(0.5 + 0.32 * light.dy)
  for (let b = 0; b < BANDS; b++) {
    const t = b / (BANDS - 1)
    for (const tinted of [false, true]) {
      const hot = ctx.ramp(lerp(0.3, 1, t))
      const cold = mixHex(ctx.ramp(lerp(0.03, 0.36, t)), palette.ink, 0.4)
      defs.push(el('radialGradient',
        {
          id: `${uid}-${tinted ? 'af' : 'lf'}${b}`, gradientUnits: 'objectBoundingBox',
          cx: gx, cy: gy, r: '82%',
        },
        el('stop', {
          offset: '0%',
          'stop-color': tinted ? mixHex(hot, palette.accent, 0.35) : hot,
        }) +
        el('stop', {
          offset: '100%',
          'stop-color': tinted ? mixHex(cold, palette.accent, 0.22) : cold,
        })))
    }
  }

  defs.push(
    // the accent plant's own stem, ordinary at the root and accent at the tip
    el('linearGradient',
      {
        id: `${uid}-stalk`, gradientUnits: 'objectBoundingBox',
        x1: '0%', y1: '100%', x2: '0%', y2: '0%',
      },
      el('stop', { offset: '0%', 'stop-color': ctx.ramp(0.6) }) +
      el('stop', { offset: '58%', 'stop-color': mixHex(ctx.ramp(0.88), palette.accent, 0.4) }) +
      el('stop', { offset: '100%', 'stop-color': palette.accent })),
    el('radialGradient', { id: `${uid}-halo` },
      el('stop', { offset: '0%', 'stop-color': withAlpha(palette.accent, 0.34) }) +
      el('stop', { offset: '52%', 'stop-color': withAlpha(palette.accent, 0.11) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(palette.accent, 0) })),
    // the pool of air the clump stands in
    el('radialGradient', { id: `${uid}-pool` },
      el('stop', { offset: '0%', 'stop-color': withAlpha(ctx.ramp(0.42), 0.26) }) +
      el('stop', { offset: '58%', 'stop-color': withAlpha(ctx.ramp(0.3), 0.12) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(ctx.ramp(0.2), 0) })),
  )

  // --- where the clump is --------------------------------------------------
  /**
   * Everything gathers on the subject and the rest of the ground stays empty.
   *
   * A gaussian around the focal centre does that on its own: two thirds of the
   * stems land inside a band less than half the frame wide, and the tail gives
   * the few strays that stop the clump reading as a bouquet. Two thin satellite
   * clumps sit further out to keep the emptiness from looking like a crop.
   */
  const sigma = w * lerp(0.13, 0.3, spreadK)
  const baseY = ctx.baseline
  const sat: { x: number; k: number }[] = []
  const sats = skel.int(1, 2)
  for (let i = 0; i < sats; i++) {
    const dir = skel.bool() ? 1 : -1
    sat.push({ x: focal.cx + dir * w * skel.range(0.32, 0.58), k: skel.range(0.2, 0.4) })
  }

  const count = Math.round(lerp(14, 34, densityK))
  const specs: (Spec & { z: number })[] = []

  for (let i = 0; i < count; i++) {
    const pick = skel.next()
    let cx = focal.cx
    let mass = 1
    for (const st of sat) {
      if (pick > 1 - st.k * 0.35) {
        cx = st.x
        mass = 0.62
      }
    }
    const rootX = cx + skel.gauss() * sigma * (mass < 1 ? 0.3 : 1)
    if (rootX < -w * 0.15 || rootX > w * 1.15) continue
    const rootY = baseY + u(skel.range(8, 64))

    // Heights carry a skyline: a slow noise along x so neighbours agree, and a
    // per-stem draw so no two agree exactly. Three to one, root to crown.
    const reach = clamp(rootY - (focal.cy - focal.ry * 1.4), short * 0.34, short * 1.1)
    const sky = 0.5 + 0.5 * ctx.fbm(n(rootX) * 0.005, 17, 2)
    const height = reach * lerp(0.34, 1.02, sky) * skel.range(0.82, 1.18) * mass

    const z = skel.next()
    const scale = lerp(0.6, 1.35, z) * mass
    const fall = ctx.falloff(rootX, rootY - height * 0.6)
    const headRoll = skel.next()
    specs.push({
      rootX, rootY, height,
      nodes: clamp(Math.round(lerp(4, 11, densityK) * lerp(0.7, 1.2, z)), 3, 12),
      leafLen: short * lerp(0.05, 0.14, leafK) * lerp(0.72, 1.3, z),
      sway, weightK, tilt: skel.range(-0.08, 0.08),
      z,
      look: {
        z, scale,
        tone: ctx.ramp(0.3 + 0.55 * lerp(0.35, 1, z) * (0.5 + 0.5 * fall)),
        alpha: 0.62 + 0.35 * z,
        detail: true,
        tinted: false,
        head: headRoll < 0.3 ? 'none' : headRoll < 0.66 ? 'umbel' : 'spike',
      },
    })
  }

  // The accent is a whole plant, not a dot: the tallest stem nearest the focal
  // centre, so the eye that finds the glow finds the subject with it.
  let accentAt = -1
  let bestScore = Infinity
  for (let i = 0; i < specs.length; i++) {
    const sp = specs[i] as Spec & { z: number }
    if (sp.z < 0.3) continue
    const score = Math.abs(sp.rootX - focal.cx) / w - sp.height / short
    if (score < bestScore) {
      bestScore = score
      accentAt = i
    }
  }
  if (accentAt >= 0) {
    const sp = specs[accentAt] as Spec & { z: number }
    sp.look.tinted = true
    sp.look.head = sp.look.head === 'none' ? 'umbel' : sp.look.head
  }

  // near to far last, so a stem in front of another actually covers it
  specs.sort((a, b) => a.z - b.z)

  // --- the clump -----------------------------------------------------------
  const softClump: string[] = []
  const sharpClump: string[] = []
  let accent: string | undefined

  for (let i = 0; i < specs.length; i++) {
    if ((i & 3) === 0 && ctx.expired()) break
    const sp = specs[i] as Spec & { z: number }
    const g = grow(ctx, skel, sp)
    if (sp.look.tinted) {
      sharpClump.push(g.marks)

      // The one bright thing in the frame is the head of that plant, and the
      // glow spills a little way down onto the leaves under it so the light
      // has somewhere to land instead of ending at the edge of a disc.
      const tipX = g.pts[g.pts.length - 2] as number
      const tipY = g.pts[g.pts.length - 1] as number
      const hr = Math.max(u(2), g.headR * 0.5)
      let bright = el('circle', { cx: tipX, cy: tipY, r: hr * 4.6, fill: `url(#${uid}-halo)` })
      const florets = 6
      for (let k = 0; k < florets; k++) {
        const a = g.tipA + (k / florets - 0.5) * 2.1
        const d = hr * skel.range(1.1, 2.6)
        bright += el('circle', {
          cx: tipX + Math.cos(a) * d, cy: tipY + Math.sin(a) * d,
          r: hr * skel.range(0.4, 0.75), fill: palette.accent,
        })
      }
      accent = bright
      continue
    }
    if (sp.z < 0.34) softClump.push(g.marks)
    else sharpClump.push(g.marks)
  }

  // --- the haze ------------------------------------------------------------
  /**
   * The far pass is a different drawing, not the same drawing smaller.
   *
   * Copying the clump behind itself gives no depth at all — it reads as one
   * design at two crispnesses. At this blur the ribs, casts and seed stipple
   * are noise, so they are switched off and what is left is soft foliage mass
   * pushed most of the way to the ground colour.
   */
  const hazeMarks: string[] = []
  const hazeCount = Math.round(lerp(9, 19, densityK))
  for (let i = 0; i < hazeCount; i++) {
    if (ctx.expired()) break
    const rootX = focal.cx + skel.gauss() * sigma * 1.35
    if (rootX < -w * 0.25 || rootX > w * 1.25) continue
    const rootY = baseY + u(skel.range(20, 90))
    const reach = clamp(rootY - (focal.cy - focal.ry * 0.5), short * 0.2, short * 0.8)
    const tone = toward(palette, ctx.ramp(0.5), 0.55)
    hazeMarks.push(grow(ctx, skel, {
      rootX, rootY,
      height: reach * skel.range(0.4, 0.95),
      nodes: skel.int(4, 8),
      leafLen: short * lerp(0.04, 0.1, leafK) * skel.range(0.8, 1.3),
      sway, weightK: weightK * 1.2, tilt: skel.range(-0.14, 0.14),
      look: {
        z: 0, scale: skel.range(0.5, 0.85), tone, alpha: 0.5,
        detail: false, tinted: false,
        head: skel.next() < 0.5 ? 'none' : 'umbel',
      },
    }).marks)
  }

  // the ground the clump rises out of, so no stem ends in mid-air
  const soil = el('ellipse', {
    cx: focal.cx, cy: baseY + u(26), rx: sigma * 2.2, ry: u(46),
    fill: withAlpha(palette.ink, 0.4), filter: `url(#${uid}-haze)`,
  })
  const haze = el('g', { filter: `url(#${uid}-haze)`, opacity: 0.85 }, hazeMarks.join(''))

  // --- the fine scale at the roots ----------------------------------------
  /**
   * Grass. Hairlines a third of a unit wide at fifteen percent, clustered under
   * the clump — the second scale of detail, and the thing that makes the roots
   * belong to a ground rather than stop at one.
   */
  const blades = Math.round(lerp(70, 200, densityK) * clamp(ctx.quality, 0.4, 2))
  const turf: string[] = []
  for (let i = 0; i < blades; i++) {
    const x = focal.cx + ctx.rng.gauss() * sigma * 1.6
    if (x < -u(20) || x > w + u(20)) continue
    const y = baseY + u(ctx.rng.range(-10, 40))
    const tall = u(ctx.rng.range(20, 40)) * (0.5 + 0.8 * ctx.falloff(x, y))
    const tilt = ctx.rng.range(-0.5, 0.5)
    turf.push(el('path', {
      d: `M${f(x)} ${f(y)}Q${f(x + tilt * tall * 0.2)} ${f(y - tall * 0.6)} ` +
        `${f(x + tilt * tall * 0.8)} ${f(y - tall)}`,
      fill: 'none', stroke: withAlpha(ctx.ramp(0.75), 0.15),
      'stroke-width': u(0.3), 'stroke-linecap': 'round',
    }))
  }

  /**
   * The same drawing inside the form as outside it.
   *
   * `back` is clipped to outside the focal form and `subject` to inside, so
   * handing both the identical stack covers the frame with no seam anywhere.
   * The plane of focus is then a blur and a contrast difference and nothing
   * else — the old version put a denser, sharper copy inside the form only,
   * and that hard-edged step is what read as a cut-out pasted on the picture.
   */
  const body = [
    // The pool goes down first and, like everything else here, identically on
    // both sides of the clip. A soft round gradient sitting under the clump
    // gives the eye somewhere to settle, and it straddles the focal edge so
    // that edge stops being the brightest boundary in the frame.
    el('ellipse', {
      cx: focal.cx, cy: focal.cy + focal.ry * 0.2,
      rx: focal.rx * 2.5, ry: focal.ry * 2.1, fill: `url(#${uid}-pool)`,
    }),
    soil,
    haze,
    el('g', { filter: `url(#${uid}-mid)` }, softClump.join('')),
    turf.join(''),
    sharpClump.join(''),
  ]
  back.push(...body)
  subject.push(...body)

  // --- the near stem -------------------------------------------------------
  /**
   * One plant so close to the lens that it is only a dark shape, cutting a
   * corner. It replaces the hairline arc that used to sweep the frame, which
   * read as a stray thread because it had no width, no taper and nothing on it.
   */
  // It roots outside the corner the subject is furthest from and leans back in
  // across it, so it cuts the frame on a diagonal. A near stem left upright is
  // a dark bar down one side, which is a different kind of crude.
  const side = focal.cx > w * 0.5 ? 1 : -1
  const nearMarks: string[] = []
  for (let i = 0; i < 2; i++) {
    nearMarks.push(grow(ctx, skel, {
      rootX: (side > 0 ? -w * 0.06 : w * 1.06) + side * w * skel.range(0.04, 0.2) * i,
      rootY: h + u(skel.range(10, 50)),
      height: short * skel.range(0.8, 1.35),
      nodes: skel.int(3, 6),
      leafLen: short * lerp(0.09, 0.19, leafK),
      sway: sway * 1.4, weightK: weightK * 1.9,
      tilt: side * skel.range(0.22, 0.5),
      look: {
        z: 1, scale: skel.range(1.5, 2.4),
        tone: mixHex(ctx.ramp(0.18), palette.ink, 0.72),
        alpha: 1, detail: false, tinted: false, head: 'none',
      },
    }).marks)
  }
  front.push(el('g', { filter: `url(#${uid}-fore)`, opacity: 0.32 }, nearMarks.join('')))

  // --- pollen --------------------------------------------------------------
  /**
   * Motes in the beam, not dust on the frame. They ride the light's own axis
   * through the subject and fade out along it, so they say where the light is
   * coming from instead of speckling the whole picture evenly.
   */
  if (pollenK > 0.02) {
    const motes = Math.round(lerp(0, 70, pollenK) * clamp(ctx.quality, 0.4, 2))
    const dust: string[] = []
    for (let i = 0; i < motes; i++) {
      const along = ctx.rng.range(-1, 1)
      const across = ctx.rng.gauss() * 0.3
      const x = focal.cx + light.dx * along * short * 0.6 - light.dy * across * short * 0.5
      const y = focal.cy + light.dy * along * short * 0.6 + light.dx * across * short * 0.5
      if (x < -u(20) || x > w + u(20) || y < -u(20) || y > h + u(20)) continue
      const mag = ctx.rng.next() ** 2.2
      const near = 1 - Math.min(1, Math.abs(along))
      dust.push(el('circle', {
        cx: x, cy: y, r: u(1 + 5 * mag),
        fill: withAlpha(ctx.ramp(1), (0.1 + 0.35 * mag) * (0.25 + 0.75 * near)),
      }))
    }
    front.push(el('g', { filter: `url(#${uid}-fore)` }, dust.join('')))
  }

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const botanicalStems: Renderer = {
  id: 'botanical-stems',
  name: 'Botanical Stems',
  family: 'organic',
  dark: true,
  focals: ['arch', 'circle', 'ellipse'],
  sampler: 'field',
  schema,
  render,
}
