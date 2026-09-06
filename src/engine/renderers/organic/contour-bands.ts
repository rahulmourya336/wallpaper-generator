import { clamp, el, lerp, smooth } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A survey of one hill.
 *
 * The old version stacked wavy hairlines from edge to edge and called the
 * middle one a ridge. That is a graph: evenly spaced lines cannot say where
 * the land is, because a contour carries its meaning in its SPACING — close
 * together is steep, far apart is flat — and lines drawn at a fixed pitch say
 * "flat" everywhere while pretending otherwise.
 *
 * So the marks are derived from a landform instead of decorated to look like
 * one. A crest runs through the focal point with an elevation profile along
 * it; every contour is the level set of that profile, which means each one
 * closes around the summit on its own, the noses round off where the ridge
 * drops away, and the whole set nests without ever being told to. Levels are
 * equal steps in HEIGHT, so plan-view spacing falls out of the slope: tight on
 * the steep flank, open on the gentle one, and open again out on the apron
 * where two or three near-straight lines are all that is left. That is what
 * gathers the marks around the subject and leaves the rest of the frame as
 * ground rather than as leftover space.
 *
 * Mass comes from stacking: every closed contour is also filled, very faintly,
 * so tone accumulates toward the summit the way a hypsometric tint does and
 * the hill stands against the sky instead of floating on it. The second scale
 * is interpolated half-contours crowded onto one flank — engraved shading that
 * follows the form, sitting on whichever side the light argues for.
 *
 * Every mark that crosses the focal edge is drawn twice, into `back` and into
 * `subject`, because those clip to the outside and the inside of the form. The
 * old version handed the dense pass to `subject` alone, which is a different
 * drawing inside the silhouette — a stamp pressed onto the picture rather than
 * a landform the form happens to sit on.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Contour interval', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'turbulence', label: 'Relief', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'ridge', label: 'Steepness', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'shading', label: 'Hatching', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'arch', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette } = ctx
  const densityK = ctx.num('density')
  const turb = ctx.num('turbulence')
  const ridgeK = ctx.num('ridge')
  const weightK = ctx.num('weight')
  const shadeK = ctx.num('shading')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []
  const defs: string[] = []

  // --- the ridge the survey is of ------------------------------------------
  // Sampled along its own length, in a parameter that runs well off the frame
  // at both ends, so the lowest contours close where nobody can see them.
  const M = Math.max(48, Math.round(108 * Math.max(0.5, ctx.quality ** 0.4)))
  const L = Math.hypot(w, h) * 0.8
  const ang = skel.range(-0.46, 0.46)
  const ax = Math.cos(ang)
  const ay = Math.sin(ang)
  // The landform is sized off the subject, with a floor under it. Tied to the
  // focal alone a small quiet subject gave a hill too fine to read as land;
  // tied to the frame alone it stopped belonging to the composition.
  const hillR = Math.max(ctx.short * 0.24, (focal.rx + focal.ry) * 0.5)
  const span = clamp((hillR * 3.1) / L, 0.05, 0.3)
  const s1 = skel.range(-0.05, 0.05)
  const s2 = s1 + (skel.bool() ? 1 : -1) * skel.range(1.5, 2.6) * span
  const amp2 = skel.range(0.24, 0.5)
  const wobK = hillR * 1.15 * (0.3 + turb)
  const phase = skel.range(0, 40)

  const PX = new Float64Array(M + 1)
  const PY = new Float64Array(M + 1)
  const NX = new Float64Array(M + 1)
  const NY = new Float64Array(M + 1)
  const EV = new Float64Array(M + 1)

  let eMax = 1e-6
  for (let k = 0; k <= M; k++) {
    const s = -1 + (2 * k) / M
    const wob = ctx.fbm(s * 1.6 + phase, 3.1, 3) * wobK
    PX[k] = focal.cx + ax * (s * L) - ay * wob
    PY[k] = focal.cy + ay * (s * L) + ax * wob
    // a summit, a lesser shoulder for the saddle between them, and a wide low
    // apron that carries the last two contours out into the empty ground
    const g1 = Math.exp(-(((s - s1) / span) ** 2))
    const g2 = amp2 * Math.exp(-(((s - s2) / (span * 0.72)) ** 2))
    const apron = 0.16 * Math.exp(-(((s - s1) / (span * 4)) ** 2))
    const rough = ctx.fbm(s * 5.4 + phase, 8.4, 3) * 0.16 * turb * (g1 + g2)
    const e = Math.max(0, g1 + g2 + apron + rough)
    EV[k] = e
    if (e > eMax) eMax = e
  }

  let kTop = 0
  for (let k = 0; k <= M; k++) {
    const e = ((EV[k] as number) / eMax)
    EV[k] = e
    if (e > (EV[kTop] as number)) kTop = k
    const a = k > 0 ? k - 1 : 0
    const b = k < M ? k + 1 : M
    const tx = (PX[b] as number) - (PX[a] as number)
    const ty = (PY[b] as number) - (PY[a] as number)
    const len = Math.hypot(tx, ty) || 1
    NX[k] = -ty / len
    NY[k] = tx / len
  }

  /**
   * Which flank carries the shading.
   *
   * The ramp is contrast against the ground, not luminance, so accumulating
   * marks means "more present" — light on a dark ground and ink on a pale one.
   * Hatching the same flank in both cases would light one of them from the
   * wrong side, so the tone goes to the lit slope on a dark ground and to the
   * turned-away slope on paper, and the steep face is put under it either way.
   */
  const facing =
    (NX[kTop] as number) * ctx.light.dx + (NY[kTop] as number) * ctx.light.dy > 0 ? 1 : -1
  const tone = palette.mode === 'light' ? -facing : facing
  const kwOpen = hillR * 3.1
  const kwSteep = kwOpen * lerp(0.6, 0.24, ridgeK)
  const kwFor = (sign: number) => (sign === tone ? kwSteep : kwOpen)

  const at = (arr: Float64Array, kf: number) => {
    const i = Math.floor(kf)
    const a = arr[clamp(i, 0, M)] as number
    const b = arr[clamp(i + 1, 0, M)] as number
    return a + (b - a) * (kf - i)
  }

  /**
   * Plan distance from the crest for a given height above the contour.
   *
   * Rounded at the top, so a loop closes with a nose rather than a needle, and
   * opening out at the foot, so the last contours before the apron are the
   * widely spaced ones.
   */
  const profile = (d: number) => d ** 0.62 * (0.42 + 0.58 * d)

  /**
   * Levels below zero are the plain the hill stands on.
   *
   * The plain has a regional gradient of its own, far gentler than the hill's,
   * so its contours are a long way apart — which is exactly why the empty part
   * of the frame gets two or three lines rather than none or a hundred. They
   * still carry the hill's deflection, because a contour crossing the foot of a
   * hill bulges around it.
   */
  const plainStep = ctx.short * 0.3

  const halfWidth = (kf: number, v: number, sign: number) => {
    const d = at(EV, kf) - Math.max(v, 0)
    const flat = v < 0 ? (-v * N) * plainStep : 0
    if (d <= 0) return flat
    const s = -1 + (2 * kf) / M
    // the relief moves slowly with height, which is what keeps the set nested
    const rel = ctx.fbm(s * 3.4 + (sign === tone ? 0 : 21), v * 2 + 6.5, 3) * 0.26 * turb
    return kwFor(sign) * profile(d) * clamp(1 + rel, 0.3, 1.8) + flat
  }

  /**
   * The stretch of the survey line worth sampling at all.
   *
   * The crest runs a long way past both edges so the lowest contours can close
   * out of sight; walking their loops the whole way is thousands of points
   * describing land nobody sees. The margin is wide — the widest contour plus
   * a third of the frame — because this only trims waste, and it is `chop`
   * below that decides what actually leaves the picture.
   */
  const margin = ctx.short * 0.3 + kwOpen
  let kMin = M
  let kMax = 0
  for (let k = 0; k <= M; k++) {
    const x = PX[k] as number
    const y = PY[k] as number
    if (x > -margin && x < w + margin && y > -margin && y < h + margin) {
      if (k < kMin) kMin = k
      if (k > kMax) kMax = k
    }
  }
  if (kMin > kMax) { kMin = 0; kMax = M }

  /** Contiguous stretches of the crest standing above a height. */
  const runs = (v: number): number[][] => {
    const out: number[][] = []
    let start = -1
    for (let k = 0; k <= M; k++) {
      const above = (EV[k] as number) > v
      if (above && start < 0) {
        const p = k > 0 ? (EV[k - 1] as number) : (EV[0] as number)
        start = k > 0 ? k - 1 + (v - p) / ((EV[k] as number) - p || 1) : 0
      } else if (!above && start >= 0) {
        const p = EV[k - 1] as number
        out.push([start, k - 1 + (p - v) / (p - (EV[k] as number) || 1)])
        start = -1
      }
    }
    if (start >= 0) out.push([start, M])
    const cut: number[][] = []
    for (const r of out) {
      const lo = Math.max(r[0] as number, kMin)
      const hi = Math.min(r[1] as number, kMax)
      // the third value says whether the loop still closes on its own: a run
      // cut by the band ends on a straight chord, and a chord is only ever
      // allowed to be a line, never the edge of a tint
      if (hi - lo > 1.5) cut.push([lo, hi, lo === (r[0] as number) && hi === (r[1] as number) ? 1 : 0])
    }
    return cut
  }

  /**
   * Nothing is carried far outside the frame.
   *
   * A contour at the foot of the hill is a very long curve most of which is
   * off the picture, and the rasteriser the contact sheet uses gives up on
   * geometry that reaches far enough past the canvas. Marks are cut to a band
   * one fifth of the frame outside it — well beyond anything the layout
   * transform can bring back into view — with one point kept past each cut so
   * a stroke leaves the band rather than stopping on it.
   */
  const bleed = ctx.short * 0.2
  const chop = (pts: readonly number[]): number[][] => {
    const segs: number[][] = []
    let cur: number[] = []
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i] as number
      const y = pts[i + 1] as number
      if (x > -bleed && x < w + bleed && y > -bleed && y < h + bleed) {
        if (cur.length === 0 && i >= 2) cur.push(pts[i - 2] as number, pts[i - 1] as number)
        cur.push(x, y)
      } else if (cur.length > 0) {
        cur.push(x, y)
        segs.push(cur)
        cur = []
      }
    }
    if (cur.length > 0) segs.push(cur)
    return segs.filter((s) => s.length >= 6)
  }

  /** Walk one flank of a run, pushing points into a flat list. */
  const flank = (a: number, b: number, v: number, sign: number, steps: number, out: number[], reverse: boolean) => {
    for (let i = 0; i <= steps; i++) {
      const t = reverse ? 1 - i / steps : i / steps
      const kf = a + (b - a) * t
      const d = halfWidth(kf, v, sign) * sign
      out.push(at(PX, kf) + at(NX, kf) * d, at(PY, kf) + at(NY, kf) * d)
    }
  }

  /**
   * File one mark into the layers that can actually show it.
   *
   * `back` is clipped to the outside of the focal form and `subject` to the
   * inside, and a mark handed to a layer that clips all of it away is an empty
   * drawing layer — which one rasteriser we rely on treats as a fatal error
   * rather than as nothing to draw. Testing the sampled points against the same
   * silhouette the clip uses keeps every mark continuous across the edge and
   * emits it once where it is invisible on one side.
   */
  const fillOut: string[][] = [[], []]
  const lineOut: string[][] = [[], []]

  const place = (pts: readonly number[], mark: string, out: string[][]) => {
    let swallowed = false
    let touches = false
    for (const foc of ctx.focals) {
      let inside = true
      for (let i = 0; i < pts.length; i += 2) {
        if (foc.norm(pts[i] as number, pts[i + 1] as number) < 1) touches = true
        else inside = false
      }
      if (inside) swallowed = true
    }
    if (!swallowed) out[0]?.push(mark)
    if (touches) out[1]?.push(mark)
  }

  /** A stroked mark, cut to the band and filed one piece at a time. */
  const stroke = (pts: readonly number[], a: Record<string, string | number>, closed: boolean) => {
    const whole = chop(pts)
    if (closed && whole.length === 1 && (whole[0] as number[]).length === pts.length) {
      place(pts, el('path', { d: `${smooth(pts, 0.5)}Z`, fill: 'none', ...a }), lineOut)
      return true
    }
    for (const seg of whole) place(seg, el('path', { d: smooth(seg, 0.5), fill: 'none', ...a }), lineOut)
    return false
  }

  // --- the contours ---------------------------------------------------------
  const N = Math.round(lerp(11, 24, densityK))

  for (let i = 0; i < N + 3; i++) {
    if ((i & 3) === 0 && ctx.expired()) break
    const v = (N - i - 0.5) / N
    // alpha thins outward so the hill dissolves into the ground rather than
    // ending on a line
    const fade = Math.exp(-i / (N * 0.8))
    // every fifth contour indexed, the way a map does it — but only on the
    // hill: an indexed line out on the plain would be the loudest mark in the
    // emptiest part of the frame
    const index = i % 5 === 0 && i < N

    for (const [a, b, shut] of runs(v)) {
      const lo = a as number
      const hi = b as number
      const steps = Math.max(10, Math.round(hi - lo))
      const plus: number[] = []
      const minus: number[] = []
      flank(lo, hi, v, 1, steps, plus, false)
      flank(lo, hi, v, -1, steps, minus, true)
      if (plus.length < 6) continue
      const pts = shut ? [...plus, ...minus] : plus

      const mid = clamp(Math.round((lo + hi) / 2), 0, M)
      const near = ctx.falloff(PX[mid] as number, PY[mid] as number)
      const paint = {
        stroke: withAlpha(
          ctx.ramp(index ? 1 : 0.74),
          clamp((index ? 0.95 : 0.82) * fade * (0.72 + 0.28 * near), 0.07, 0.95),
        ),
        'stroke-width': u((index ? 3 : 1.55) * weightK),
      }

      // A run cut short by the band has no nose to turn on, so its two flanks
      // are drawn as separate open curves. Joined, they would meet across a
      // straight chord that has nothing to do with the land.
      let whole = false
      if (shut) {
        whole = stroke(pts, paint, true)
      } else {
        stroke(plus, paint, false)
        stroke(minus, paint, false)
      }

      // Tone only where the contour is a closed ring in the picture. A loop cut
      // by the band ends on a straight chord, and a chord filled is a hard edge
      // across the frame with nothing in the land to justify it.
      if (whole) {
        place(pts, el('path', {
          d: `${smooth(pts, 0.5)}Z`,
          fill: withAlpha(ctx.ramp(lerp(0.36, 0.06, i / Math.max(1, N - 1))), 0.042),
        }), fillOut)

        // the toned flank gets a second, one-sided wash: a hill lit from one
        // side has a heavier half, and a symmetric tint says it is lit from above
        if (i < N * 0.55) {
          const half: number[] = []
          flank(lo, hi, v, tone, steps, half, false)
          for (let s = steps; s >= 0; s--) {
            const kf = hi + (lo - hi) * (s / steps)
            half.push(at(PX, kf), at(PY, kf))
          }
          place(half, el('path', { d: `${smooth(half, 0.5)}Z`, fill: withAlpha(ctx.ramp(0.3), 0.022) }), fillOut)
        }
      }
    }
  }

  // --- the engraving --------------------------------------------------------
  // Half-contours between the drawn ones, on the toned flank only. Broken at
  // staggered points so the run ends never line up into an edge of their own.
  if (shadeK > 0.04) {
    const sub = Math.round(lerp(1, 4, shadeK))
    const top = Math.round(N * 0.5)
    for (let i = 0; i < top; i++) {
      if ((i & 3) === 0 && ctx.expired()) break
      for (let j = 1; j <= sub; j++) {
        const v = (N - i - 0.5) / N - j / ((sub + 1) * N)
        for (const [a, b] of runs(v)) {
          const lo = a as number
          const hi = b as number
          const trimA = lo + (hi - lo) * skel.range(0.04, 0.22)
          const trimB = hi - (hi - lo) * skel.range(0.04, 0.22)
          if (trimB - trimA < 3) continue
          const pts: number[] = []
          flank(trimA, trimB, v, tone, Math.max(8, Math.round(trimB - trimA)), pts, false)
          stroke(pts, {
            stroke: withAlpha(ctx.ramp(0.58), 0.11 + 0.08 * shadeK),
            'stroke-width': u(0.8 * weightK),
            'stroke-linecap': 'round',
          }, false)
        }
      }
    }
  }

  // --- the crest ------------------------------------------------------------
  // Only where the land is actually high, so the bright mark is a summit to
  // find rather than a wire strung across the picture.
  const crestV = lerp(0.5, 0.7, ridgeK)
  const crestRuns = runs(crestV)
  let accent: string | undefined

  for (const [a, b] of crestRuns) {
    const lo = a as number
    const hi = b as number
    const steps = Math.max(8, Math.round(hi - lo))
    const raw: number[] = []
    for (let i = 0; i <= steps; i++) {
      const kf = lo + (hi - lo) * (i / steps)
      raw.push(at(PX, kf), at(PY, kf))
    }
    const pts = chop(raw)[0]
    if (!pts || pts.length < 6) continue
    const d = smooth(pts, 0.5)
    const x1 = pts[0] as number
    const y1 = pts[1] as number
    const x2 = pts[pts.length - 2] as number
    const y2 = pts[pts.length - 1] as number
    // a gradient with no length between its stops is not a fade, it is a
    // rasteriser bug waiting to happen
    if (Math.hypot(x2 - x1, y2 - y1) < u(6)) continue

    // The crest fades in and out along its own length. A stroke cannot carry an
    // alpha ramp, so the paint is a gradient of one colour with the opacity in
    // the stops.
    const gid = `${ctx.uid}-crest${Math.round(lo)}`
    defs.push(el('linearGradient',
      { id: gid, gradientUnits: 'userSpaceOnUse', x1, y1, x2, y2 },
      el('stop', { offset: '0%', 'stop-color': ctx.ramp(1), 'stop-opacity': 0 }) +
      el('stop', { offset: '22%', 'stop-color': ctx.ramp(1), 'stop-opacity': 0.85 }) +
      el('stop', { offset: '55%', 'stop-color': ctx.ramp(1), 'stop-opacity': 1 }) +
      el('stop', { offset: '100%', 'stop-color': ctx.ramp(1), 'stop-opacity': 0 })))

    place(pts, el('path', {
      d, fill: 'none', stroke: withAlpha(ctx.ramp(0.55), 0.11),
      'stroke-width': u(15 * weightK), 'stroke-linecap': 'round',
    }), lineOut)
    place(pts, el('path', {
      d, fill: 'none', stroke: `url(#${gid})`,
      'stroke-width': u(3.6 * weightK), 'stroke-linecap': 'round',
    }), lineOut)

    // one bright segment, and only on the run the summit is actually on
    if (!accent && kTop >= lo - 1 && kTop <= hi + 1) {
      const aid = `${ctx.uid}-acc`
      defs.push(el('linearGradient',
        { id: aid, gradientUnits: 'userSpaceOnUse', x1, y1, x2, y2 },
        el('stop', { offset: '0%', 'stop-color': palette.accent, 'stop-opacity': 0 }) +
        el('stop', { offset: '30%', 'stop-color': palette.accent, 'stop-opacity': 0 }) +
        el('stop', { offset: '55%', 'stop-color': palette.accent, 'stop-opacity': 0.95 }) +
        el('stop', { offset: '80%', 'stop-color': palette.accent, 'stop-opacity': 0 })))
      accent = el('path', {
        d, fill: 'none', stroke: `url(#${aid})`,
        'stroke-width': u(3.6 * weightK), 'stroke-linecap': 'round',
      })
    }
  }

  // The hill's own footprint, under everything: a single soft mass so the
  // stack has something to sit on rather than reading as line work on bare air.
  const foot = runs(0.06)[0]
  if (foot && foot[2]) {
    const lo = foot[0] as number
    const hi = foot[1] as number
    const steps = Math.max(12, Math.round(hi - lo))
    const pts: number[] = []
    flank(lo, hi, 0.06, 1, steps, pts, false)
    flank(lo, hi, 0.06, -1, steps, pts, true)
    const whole = chop(pts)
    if (pts.length >= 8 && whole.length === 1 && (whole[0] as number[]).length === pts.length) {
      behind.push(el('path', { d: `${smooth(pts, 0.5)}Z`, fill: withAlpha(ctx.ramp(0.16), 0.06) }))
    }
  }

  back.push(...(fillOut[0] as string[]), ...(lineOut[0] as string[]))
  subject.push(...(fillOut[1] as string[]), ...(lineOut[1] as string[]))

  if (!accent) {
    accent = el('circle', {
      cx: PX[kTop] as number, cy: PY[kTop] as number, r: u(4), fill: palette.accent,
    })
  }

  return { back, behind, subject, front, defs, accent }
}

export const contourBands: Renderer = {
  id: 'contour-bands',
  name: 'Contour Bands',
  family: 'organic',
  dark: true,
  focals: ['circle', 'ellipse', 'arch', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
