import { clamp, el, f, group, lerp, smooth } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Ribbons, not stripes.
 *
 * A slab of flat colour with a hairline around it is a stripe, and a stack of
 * them evenly spaced down the frame is upholstery. What makes a ribbon read as
 * ribbon is that it TURNS: half-width here is driven by cos(theta) along the
 * length, so every band pinches to a waist and re-opens showing its back face
 * in a different ink. That single move is what buys the form.
 *
 * Shading is two flat fills per face — lit and shadow, split by a curve offset
 * from the spine on the side ctx.light comes from — with a halftone bridging
 * the step and ink hatching crowding the shadow edge. Hard-edged throughout;
 * this family is printed, not photographed.
 *
 * Scale does the composition: two or three hero ribbons a third of the frame
 * across, a few mid bands, and hairline threads that ride the hero edges. They
 * cluster on the focal form — one crossing in front of it, one passing behind
 * so the form tint washes over it — and leave the far ground bare.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'turbulence', label: 'Sweep', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'ribbon', label: 'Ribbon width', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'hatch', label: 'Hatching', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'twist', label: 'Twist', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'diamond', 'arch'], default: 'auto' },
]

/** One point on a ribbon: spine position, unit normal, half-width, which face. */
type Sample = { x: number; y: number; nx: number; ny: number; hw: number; face: number }

type Spine = (x: number) => number
/** signed half-width; the sign is the face, so a zero crossing is a twist */
type Width = (t: number, x: number) => number

function sampleBand(spine: Spine, width: Width, x0: number, x1: number, n: number): Sample[] {
  const out: Sample[] = []
  const step = (x1 - x0) / (n - 1)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const x = x0 + step * i
    const dy = spine(x + step * 0.5) - spine(x - step * 0.5)
    const len = Math.hypot(step, dy) || 1
    const sw = width(t, x)
    out.push({ x, y: spine(x), nx: -dy / len, ny: step / len, hw: Math.abs(sw), face: sw < 0 ? -1 : 1 })
  }
  return out
}

/** A curve parallel to the spine at cross fraction v, where 1 is the lit edge. */
function edge(s: readonly Sample[], side: number, v: number): number[] {
  const pts: number[] = []
  for (let i = 0; i < s.length; i++) {
    const p = s[i] as Sample
    const o = side * p.hw * v
    pts.push(p.x + p.nx * o, p.y + p.ny * o)
  }
  return pts
}

/** The strip between two cross fractions, closed. */
function bandPath(s: readonly Sample[], side: number, vA: number, vB: number): string {
  const a = edge(s, side, vA)
  const b = edge(s, side, vB)
  const rev: number[] = []
  for (let i = b.length - 2; i >= 0; i -= 2) rev.push(b[i] as number, b[i + 1] as number)
  const head = smooth(a)
  const tail = smooth(rev)
  if (!head || !tail) return ''
  return `${head}L${tail.slice(1)}Z`
}

/**
 * Cut the ribbon where the twist flips it over.
 *
 * The two runs share a waist point so front and back face meet exactly, with
 * no seam and no overlap — the pinch is the join.
 */
function faceRuns(s: readonly Sample[]): { face: number; pts: Sample[] }[] {
  const runs: { face: number; pts: Sample[] }[] = []
  if (s.length === 0) return runs
  let cur = { face: (s[0] as Sample).face, pts: [s[0] as Sample] }
  for (let i = 1; i < s.length; i++) {
    const p = s[i] as Sample
    if (p.face !== cur.face) {
      const q = s[i - 1] as Sample
      const waist: Sample = {
        x: (p.x + q.x) / 2, y: (p.y + q.y) / 2,
        nx: (p.nx + q.nx) / 2, ny: (p.ny + q.ny) / 2,
        hw: Math.min(p.hw, q.hw), face: cur.face,
      }
      cur.pts.push(waist)
      runs.push(cur)
      cur = { face: p.face, pts: [{ ...waist, face: p.face }] }
    }
    cur.pts.push(p)
  }
  runs.push(cur)
  return runs
}

function at(s: readonly Sample[], t: number): Sample {
  const c = clamp(t, 0, 1) * (s.length - 1)
  const i = Math.min(s.length - 2, Math.max(0, Math.floor(c)))
  const a = s[i] as Sample
  const b = s[i + 1] as Sample
  const k = c - i
  return {
    x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k),
    nx: lerp(a.nx, b.nx, k), ny: lerp(a.ny, b.ny, k),
    hw: lerp(a.hw, b.hw, k), face: a.face,
  }
}

/** Contiguous stretches wide enough to carry a mark of the given size. */
function wideRuns(s: readonly Sample[], min: number): Sample[][] {
  const out: Sample[][] = []
  let run: Sample[] = []
  for (let i = 0; i < s.length; i++) {
    const p = s[i] as Sample
    if (p.hw >= min) run.push(p)
    else if (run.length > 2) { out.push(run); run = [] }
    else run = []
  }
  if (run.length > 2) out.push(run)
  return out
}

function dotSub(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(r * 2)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-r * 2)} 0`
}

type Tone = { lit: string; shadow: string }

type Draw = {
  front: Tone
  backFace: Tone
  /** hatch lines per face run, 0 for none */
  hatch: number
  /** halftone screen bridging the two flats, worth it only on wide bands */
  screen: boolean
  /** the mis-registered plate: a chunky sliver of ground inside the lit edge */
  knockout: boolean
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette, light } = ctx
  const densityK = ctx.num('density')
  const sweep = ctx.num('turbulence')
  const ribbonK = ctx.num('ribbon')
  const hatchK = ctx.num('hatch')
  const twistK = ctx.num('twist')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  // ribbons must enter and leave the frame, so nothing reads as a floating shape
  const over = ctx.short * 0.3
  const xa = -over
  const xb = w + over
  const waist = u(6)
  const N = 56

  const lx = light.dx
  const ly = -light.dy

  /** a spine that tilts, sweeps, and wanders a little off the sine */
  function makeSpine(yc: number, tilt: number, amp: number): Spine {
    const k1 = skel.range(0.45, 1.05)
    const p1 = skel.range(0, Math.PI * 2)
    const a2 = amp * skel.range(0.2, 0.5)
    const k2 = skel.range(1.5, 2.8)
    const p2 = skel.range(0, Math.PI * 2)
    return (x) => {
      const t = (x - xa) / (xb - xa)
      return yc + tilt * (t - 0.5) * h
        + amp * Math.sin(k1 * t * Math.PI * 2 + p1)
        + a2 * Math.sin(k2 * t * Math.PI * 2 + p2)
    }
  }

  /**
   * cos along the length: the band pinches, flips face, and re-opens.
   *
   * Raised to a fractional power because a raw cosine spends most of the frame
   * narrow, which turns the ribbon into a tapering swoosh. A real ribbon holds
   * its width and gives it up quickly at the turn.
   */
  function makeWidth(hwMax: number, twists: number): Width {
    const phase = twists === 0 ? 0 : skel.range(-0.5, 0.5)
    const nz = skel.range(0, 40)
    return (t, x) => {
      const env = 0.84 + 0.16 * ctx.noise2(ctx.n(x) * 0.7, nz)
      if (twists === 0) return hwMax * env
      const c = Math.cos(phase + twists * Math.PI * t)
      const raw = hwMax * Math.abs(c) ** 0.62 * env
      return (c < 0 ? -1 : 1) * Math.max(raw, waist)
    }
  }

  function ribbon(s: readonly Sample[], d: Draw): string {
    const parts: string[] = []
    let dot = 0
    for (let i = 0; i < s.length; i++) {
      const p = s[i] as Sample
      dot += p.nx * lx + p.ny * ly
    }
    // orient the ribbon so +normal is always the lit edge; the shading then
    // agrees with the light without branching per point
    const side = dot >= 0 ? 1 : -1
    const facing = clamp(Math.abs(dot) / s.length, 0, 1)
    const vSplit = -0.12 - 0.36 * facing

    for (const run of faceRuns(s)) {
      if (run.pts.length < 2) continue
      const tone = run.face > 0 ? d.front : d.backFace
      const body = bandPath(run.pts, side, 1, -1)
      if (!body) continue
      parts.push(el('path', { d: body, fill: tone.lit }))
      parts.push(el('path', { d: bandPath(run.pts, side, vSplit, -1), fill: tone.shadow }))

      // halftone: dots of the lit ink crowding the split line and dying out
      // toward the shadow edge, so the two flats meet through a screen
      if (d.screen) {
        const pitch = u(13)
        const rows = 4
        const first = run.pts[0] as Sample
        const last = run.pts[run.pts.length - 1] as Sample
        const cols = clamp(Math.round(Math.abs(last.x - first.x) / pitch), 2, 120)
        let dd = ''
        for (let j = 0; j < rows; j++) {
          const v = lerp(vSplit, -1, (j + 0.5) / rows)
          const r = u(3.6) * (1 - j / rows) ** 0.7
          for (let c = 0; c < cols; c++) {
            const p = at(run.pts, (c + (j % 2) * 0.5 + 0.25) / cols)
            if (p.hw < u(34)) continue
            const o = side * p.hw * v
            dd += dotSub(p.x + p.nx * o, p.y + p.ny * o, Math.min(r, p.hw * 0.2))
          }
        }
        if (dd) parts.push(el('path', { d: dd, fill: tone.lit, opacity: 0.92 }))
      }

      // hatch that shades: crowded and heavy at the shadow edge, thinning to
      // nothing at the lit edge, so the gradient of line weight reads as turn
      for (let k = 1; k < d.hatch; k++) {
        const v = -1 + 2 * (k / d.hatch) ** 2.3
        const q = (v + 1) / 2
        parts.push(el('path', {
          d: smooth(edge(run.pts, side, v)),
          fill: 'none',
          stroke: withAlpha(palette.ink, lerp(0.5, 0.14, q)),
          'stroke-width': u(lerp(5.5, 1.6, q)),
          'stroke-linecap': 'round',
        }))
      }
    }

    if (d.knockout) {
      for (const stretch of wideRuns(s, u(40))) {
        parts.push(el('path', {
          d: smooth(edge(stretch, side, 0.82)),
          fill: 'none',
          stroke: palette.ground,
          'stroke-width': u(8),
          'stroke-linecap': 'round',
          opacity: 0.9,
        }))
      }
    }

    return group({}, parts)
  }

  // --- the cluster ---------------------------------------------------------
  // Bands gather on the focal form and thin away from it; the far ground is
  // meant to stay bare, which is where the composition comes from.
  const cy = focal.cy
  const heroCount = densityK > 0.62 && skel.bool(0.45) ? 3 : 2
  const midCount = Math.round(lerp(2, 5, densityK))
  const threadCount = Math.round(lerp(3, 8, densityK))

  const heroHw = ctx.short * lerp(0.09, 0.19, ribbonK)
  const midHw = ctx.short * lerp(0.024, 0.062, ribbonK)
  const ampBase = h * 0.11 * (0.35 + sweep)
  const inFrame = (y: number) => clamp(y, -0.1 * h, 1.1 * h)

  type Band = { s: Sample[]; draw: Draw; layer: 'front' | 'behind' | 'through'; hw: number }
  const heroes: Band[] = []
  const bands: Band[] = []

  /**
   * Where the bands sit.
   *
   * Walking outward from the subject in uneven steps rather than dropping
   * them at t = i/count: the gaps are all different sizes, the widest bands
   * land nearest the form, and the walk stops at the frame instead of tiling
   * it. Even spacing is what made the old version read as woven cloth.
   */
  const slots: number[] = [cy + skel.range(-0.05, 0.05) * h]
  {
    let up = slots[0] as number
    let down = up
    for (let k = 0; k < 10; k++) {
      if (k % 2 === 0) {
        down += skel.range(0.14, 0.3) * h
        if (down < h * 1.12) slots.push(down)
      } else {
        up -= skel.range(0.14, 0.3) * h
        if (up > -h * 0.12) slots.push(up)
      }
    }
  }
  const slotAt = (i: number) => (i < slots.length ? (slots[i] as number) : cy + skel.gauss() * h * 0.3)

  function tones(base: number, fall: number): { front: Tone; backFace: Tone } {
    const lift = 0.16 * fall
    return {
      front: { lit: ctx.ramp(base + lift), shadow: ctx.ramp(base - 0.22 + lift * 0.5) },
      // The back face is a different ink entirely, and the loudest thing in
      // the frame after the accent — that jump in value is what makes a twist
      // land instead of reading as a shape that got thin.
      backFace: { lit: ctx.ramp(base + 0.44 + lift), shadow: ctx.ramp(base + 0.14 + lift) },
    }
  }

  for (let i = 0; i < heroCount && !ctx.expired(); i++) {
    const yc = inFrame(slotAt(i))
    const hw = heroHw * skel.range(0.82, 1.2)
    const spine = makeSpine(yc, skel.range(-0.26, 0.26), ampBase * skel.range(0.6, 1.3))
    const twists = skel.bool(0.25 + 0.7 * twistK) ? skel.int(1, 2) : 0
    const s = sampleBand(spine, makeWidth(hw, twists), xa, xb, N)
    const fall = ctx.falloff(w * 0.5, yc)
    heroes.push({
      s,
      draw: { ...tones(0.42, fall), hatch: Math.round(lerp(0, 7, hatchK)), screen: true, knockout: true },
      layer: i === 0 ? 'front' : 'through',
      hw,
    })
  }

  // one mid band riding straight through the form, tinted by it
  const behindYc = cy + skel.range(-0.55, 0.55) * focal.ry
  {
    const spine = makeSpine(behindYc, skel.range(-0.2, 0.2), ampBase * skel.range(0.5, 1))
    const hw = midHw * skel.range(1.3, 2.2)
    const twists = skel.bool(0.3 + 0.6 * twistK) ? skel.int(1, 2) : 0
    const fall = ctx.falloff(w * 0.5, behindYc)
    bands.push({
      s: sampleBand(spine, makeWidth(hw, twists), xa, xb, N),
      draw: { ...tones(0.32, fall), hatch: Math.round(lerp(0, 5, hatchK)), screen: false, knockout: false },
      layer: 'behind',
      hw,
    })
  }

  for (let i = 0; i < midCount && !ctx.expired(); i++) {
    const yc = inFrame(slotAt(heroCount + i))
    // bands thin as they walk away from the subject, so density falls off
    // through scale rather than through spacing
    const fall = ctx.falloff(w * 0.5, yc)
    const hw = midHw * skel.range(0.7, 1.5) * (0.5 + 0.6 * fall)
    const spine = makeSpine(yc, skel.range(-0.38, 0.38), ampBase * skel.range(0.5, 1.4))
    const twists = skel.bool(0.2 + 0.7 * twistK) ? skel.int(1, 2) : 0
    bands.push({
      s: sampleBand(spine, makeWidth(hw, twists), xa, xb, N),
      draw: { ...tones(0.3, fall), hatch: Math.round(lerp(0, 4, hatchK)), screen: false, knockout: false },
      layer: 'through',
      hw,
    })
  }

  // --- threads -------------------------------------------------------------
  // The fine scale. Every one of them traces the edge of a band that is
  // already there, so the eye reads them as the same object seen thin. A
  // thread set loose in the empty ground is just a stray hair.
  const hosts = [...heroes, ...bands]
  const threads: { d: string; layer: 'front' | 'through' }[] = []
  for (let i = 0; i < threadCount && hosts.length > 0 && !ctx.expired(); i++) {
    // round robin, so threads spread over the bands rather than piling onto
    // one host and matting it into hair
    const host = hosts[i % hosts.length] as Band
    const hs = host.s
    const gap = u(skel.range(5, 40))
    const hostSide = skel.bool() ? 1 : -1
    const spine: Spine = (x) => {
      const t = clamp((x - xa) / (xb - xa), 0, 1)
      const p = at(hs, t)
      return p.y + p.ny * hostSide * (p.hw + gap)
    }
    const tw = u(skel.range(1.3, 3.6))
    const s = sampleBand(spine, (t) => tw * (0.55 + 0.45 * Math.sin(Math.PI * clamp(t, 0, 1))), xa, xb, N)
    const bright = skel.bool(0.78)
    threads.push({
      d: el('path', {
        d: bandPath(s, 1, 1, -1),
        fill: bright ? ctx.ramp(skel.range(0.8, 1)) : palette.ink,
        opacity: bright ? skel.range(0.65, 0.95) : 0.55,
      }),
      layer: host.layer === 'front' ? 'front' : 'through',
    })
  }

  // --- the band that holds the empty side ----------------------------------
  // Barely off the ground in value, but carrying a coarse dot screen, so the
  // bare part of the frame has something at the fine scale to be made of and
  // the emptiness reads as chosen rather than as marks running out.
  {
    const yc = cy < h * 0.5 ? h * skel.range(0.78, 0.94) : h * skel.range(0.06, 0.22)
    const spine = makeSpine(yc, skel.range(-0.12, 0.12), ampBase * skel.range(0.4, 1))
    const s = sampleBand(spine, makeWidth(ctx.short * skel.range(0.16, 0.28), 1), xa, xb, N)
    const parts = [el('path', { d: bandPath(s, 1, 1, -1), fill: ctx.ramp(0.1), opacity: 0.9 })]
    const pitch = u(22)
    const cols = clamp(Math.round((xb - xa) / pitch), 2, 90)
    let dd = ''
    for (let j = 0; j < 5; j++) {
      const v = lerp(0.85, -0.85, (j + 0.5) / 5)
      for (let c = 0; c < cols; c++) {
        const p = at(s, (c + (j % 2) * 0.5 + 0.25) / cols)
        if (p.hw < u(18)) continue
        const o = p.hw * v
        dd += dotSub(p.x + p.nx * o, p.y + p.ny * o, Math.min(u(2.6), p.hw * 0.16))
      }
    }
    if (dd) parts.push(el('path', { d: dd, fill: ctx.ramp(0.34), opacity: 0.5 }))
    const ghost = group({}, parts)
    back.push(ghost)
    subject.push(ghost)
  }

  // --- assemble ------------------------------------------------------------
  const place = (b: Band) => {
    const g = ribbon(b.s, b.draw)
    if (!g) return
    if (b.layer === 'front') front.push(g)
    else if (b.layer === 'behind') behind.push(g)
    else { back.push(g); subject.push(g) }
  }

  for (const b of bands) place(b)
  for (let i = heroes.length - 1; i >= 0; i--) place(heroes[i] as Band)
  for (const t of threads) {
    if (t.layer === 'front') front.push(t.d)
    else { back.push(t.d); subject.push(t.d) }
  }

  // --- accent --------------------------------------------------------------
  // A single narrow thread riding the lead hero's lit edge and peeling off it
  // near the end. Never a slab: the brightest thing in the frame is the
  // thinnest, which is the only way an accent stays an accent.
  let accent: string | undefined
  const lead = heroes[0]
  if (lead) {
    const hs = lead.s
    let dot = 0
    for (let i = 0; i < hs.length; i++) {
      const p = hs[i] as Sample
      dot += p.nx * lx + p.ny * ly
    }
    const side = dot >= 0 ? 1 : -1
    const t0 = skel.range(0.1, 0.24)
    const t1 = skel.range(0.72, 0.88)
    const peel = lerp(t0, t1, skel.range(0.45, 0.65))
    const away = h * skel.range(0.035, 0.08) * (skel.bool() ? 1 : -1)
    const lipA: number[] = []
    const lipB: number[] = []
    const steps = 40
    for (let i = 0; i <= steps; i++) {
      const k = i / steps
      const t = lerp(t0, t1, k)
      const p = at(hs, t)
      const drift = t > peel ? ((t - peel) / (t1 - peel)) ** 2.2 * away : 0
      // ride the edge, but never follow the pinch all the way in — a lip that
      // dives into the twist waist reads as a kink rather than as an edge
      const o = side * (Math.max(p.hw, lead.hw * 0.34) + u(9)) + drift
      const cx = p.x + p.nx * o
      const cy2 = p.y + p.ny * o
      // tapered at both ends: a lip lifting off the edge, not a stripe
      const half = u(2.9) * Math.sin(Math.PI * k) ** 0.45
      lipA.push(cx + p.nx * half, cy2 + p.ny * half)
      lipB.push(cx - p.nx * half, cy2 - p.ny * half)
    }
    const rev: number[] = []
    for (let i = lipB.length - 2; i >= 0; i -= 2) rev.push(lipB[i] as number, lipB[i + 1] as number)
    const head = smooth(lipA)
    const tail = smooth(rev)
    accent = el('path', { d: `${head}L${tail.slice(1)}Z`, fill: palette.accent })
    // a few flecks trailing the peel, the ink that did not quite let go
    let flecks = ''
    for (let k = 0; k < 5; k++) {
      const t = clamp(peel + (t1 - peel) * ((k + 1) / 6), 0, 1)
      const p = at(hs, t)
      const drift = ((t - peel) / (t1 - peel)) ** 2.2 * away * skel.range(0.45, 0.85)
      const o = side * (Math.max(p.hw, lead.hw * 0.34) + u(9)) + drift
      flecks += dotSub(p.x + p.nx * o, p.y + p.ny * o, u(lerp(4, 1.4, k / 4)))
    }
    accent += el('path', { d: flecks, fill: palette.accent, opacity: 0.85 })
  }

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const ribbonBands: Renderer = {
  id: 'ribbon-bands',
  name: 'Ribbon Bands',
  family: 'retro-pop',
  dark: true,
  focals: ['circle', 'ellipse', 'diamond', 'arch'],
  sampler: 'field',
  schema,
  render,
}
