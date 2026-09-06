import { clamp, el, lerp, poly, smooth } from '../../svg'
import { lit } from '../../sampling'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A lazy field of lines with one eddy in it.
 *
 * The old version integrated a few hundred streamlines through the noise and
 * stroked every one of them at a hairline width, so the frame arrived as a
 * comb: same length, same weight, same value, drawn end to end with a constant
 * pen. Three things fix that, and none of them is a parameter.
 *
 * The marks are ribbons, not strokes. Each line is drawn as a filled outline
 * whose half-width is sampled per point — zero at the tail, full about three
 * fifths along, zero again at the head — and multiplied by the local falloff,
 * so a line thins as it leaves the subject and dies in the ground instead of
 * stopping with a round cap in mid-air. That single change is the difference
 * between a plotter and a brush.
 *
 * There are three classes of them, and the gap between the classes is large:
 * a handful of leaders that own the frame, a middle rank that describes the
 * flow, and a haze of hairlines at a fifth of the alpha that is texture rather
 * than drawing. Uniformity was the complaint; a spread of 1:8 in width and 1:5
 * in alpha is the answer.
 *
 * And the subject is a knot rather than a shape. The vortex used to be a weak
 * global term, which only skews the whole field slightly and never winds
 * anything; here it lives entirely inside 0.62 of the focal radius and its
 * strength climbs as the square of the approach, so the outer field stays lazy
 * and empty — the quiet direction wants most of the frame to be nothing — and
 * the leaders, seeded on a small ring at the heart and integrated in BOTH
 * directions, sweep in from off frame, coil twice and stop. What the viewer
 * finds is the eddy the lines make.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'turbulence', label: 'Turbulence', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'flow', label: 'Line length', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.5 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'vortex', label: 'Eddy', type: 'range', min: 0, max: 1, step: 0.01, default: 0.66 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'arch', 'diamond'], default: 'auto' },
]

const TAU = Math.PI * 2

/** A traced line: interleaved coordinates plus the field falloff at each one. */
type Trace = { pts: number[]; fall: number[] }

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const field = ctx.rng
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const turb = ctx.num('turbulence')
  const flowK = ctx.num('flow')
  const weightK = ctx.num('weight')
  const vortexK = ctx.num('vortex')

  /**
   * `back` stays empty on purpose.
   *
   * That stage is clipped to the inverse of the focal silhouette and `subject`
   * to its interior, so a field split between them is cut along the form edge
   * twice — which is precisely what made the old frames read as a flat cut-out
   * with lines inside it. Everything here is drawn unclipped, so a line
   * crosses the silhouette without noticing it, and the only thing inside the
   * clip is spray small enough never to reach the edge.
   */
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []
  const defs: string[] = []

  const cx = focal.cx
  const cy = focal.cy
  const R = Math.max(focal.rx, focal.ry)
  const eddyR = R * 0.72
  const scale = lerp(0.0006, 0.0021, turb)
  const bias = skel.range(0, TAU)
  const spin = skel.bool() ? 1 : -1
  const pull = lerp(1.4, 3.8, vortexK)

  /**
   * The field, plus a vortex that exists only near the middle.
   *
   * Coupling the spin globally was what kept the old field from ever winding:
   * turned up it dragged every line in the frame into one comb, so it had to
   * be left too weak to do anything at all. Confined to a disc and squared, it
   * can be strong where it matters and literally absent everywhere else. The
   * sink term is the difference between an orbit and a spiral, and it has to
   * release near the centre or every leader terminates in the same dot.
   */
  const angleAt = (x: number, y: number): number => {
    const v = ctx.fbm(n(x) * scale, n(y) * scale, 4)
    const a = bias + v * Math.PI * 1.6
    let fx = Math.cos(a)
    let fy = Math.sin(a)
    const dx = x - cx
    const dy = y - cy
    const r = Math.hypot(dx, dy)
    if (r < eddyR && r > 1e-3) {
      const q = 1 - r / eddyR
      const k = q * q * pull
      const ux = dx / r
      const uy = dy / r
      const sink = 0.26 * clamp(r / (eddyR * 0.5), 0, 1)
      fx += (-uy * spin - ux * sink) * k
      fy += (ux * spin - uy * sink) * k
    }
    return Math.atan2(fy, fx)
  }

  const stepLen = ctx.short * 0.0105
  const margin = ctx.short * 0.32

  const walk = (x0: number, y0: number, dir: number, steps: number): Trace => {
    const pts: number[] = []
    const fall: number[] = []
    let x = x0
    let y = y0
    for (let i = 0; i < steps; i++) {
      pts.push(x, y)
      fall.push(ctx.falloff(x, y))
      const a = angleAt(x, y)
      x += Math.cos(a) * stepLen * dir
      y += Math.sin(a) * stepLen * dir
      if (x < -margin || x > w + margin || y < -margin || y > h + margin) break
    }
    return { pts, fall }
  }

  /**
   * Integrated backwards as well as forwards.
   *
   * A line that starts where it is seeded has a beginning inside the picture,
   * and the eye finds beginnings. Walking out of the seed in both directions
   * and joining the halves gives a mark that entered the frame somewhere else
   * and is only passing through — and for the leaders it is what lets them be
   * seeded in the eddy itself yet still arrive from off frame.
   */
  const through = (x0: number, y0: number, backSteps: number, fwdSteps: number): Trace => {
    const b = walk(x0, y0, -1, backSteps)
    const g = walk(x0, y0, 1, fwdSteps)
    const pts: number[] = []
    const fall: number[] = []
    for (let i = b.fall.length - 1; i >= 1; i--) {
      pts.push(b.pts[i * 2] as number, b.pts[i * 2 + 1] as number)
      fall.push(b.fall[i] as number)
    }
    for (let i = 0; i < g.fall.length; i++) {
      pts.push(g.pts[i * 2] as number, g.pts[i * 2 + 1] as number)
      fall.push(g.fall[i] as number)
    }
    return { pts, fall }
  }

  // Full weight sits past the middle, so the mark loads as it approaches the
  // eddy and thins through the coil rather than being fattest where it starts.
  const PEAK = 0.62
  const taper = (t: number): number => {
    const p = t < PEAK ? t / PEAK : (1 - t) / (1 - PEAK)
    return Math.pow(clamp(p, 0, 1), 0.6)
  }

  /**
   * A line as a filled outline rather than a stroke.
   *
   * SVG gives a path exactly one width, which is why every one of these used
   * to read as pen-plotter output. Offsetting the traced points along their
   * own normals by a half-width that varies down the run costs one extra pass
   * over the points and buys the whole difference. `curved` picks bezier edges
   * for marks wide enough to show the faceting and straight ones for the
   * hairlines, where the segments are already shorter than the width.
   */
  const ribbon = (t: Trace, peak: number, curved: boolean): string => {
    const m = t.fall.length
    if (m < 4) return ''
    const left: number[] = []
    const right: number[] = []
    for (let i = 0; i < m; i++) {
      const x = t.pts[i * 2] as number
      const y = t.pts[i * 2 + 1] as number
      const p = Math.max(0, i - 1)
      const q = Math.min(m - 1, i + 1)
      const tx = (t.pts[q * 2] as number) - (t.pts[p * 2] as number)
      const ty = (t.pts[q * 2 + 1] as number) - (t.pts[p * 2 + 1] as number)
      const len = Math.hypot(tx, ty) || 1
      /**
       * A floor under the half-width, and it is not a style choice.
       *
       * Coordinates are written with one decimal past a hundred, so a ribbon
       * narrower than about a fifth of a device pixel has its two edges round
       * onto each other and becomes a zero-area polygon — invisible in a
       * browser, and a hard abort in the rasteriser the contact sheets run
       * through. A mark that thin carries no ink either way, so the floor
       * costs nothing and the taper still reads on everything above it.
       */
      const half = Math.max(
        peak * taper(i / (m - 1)) * (0.28 + 0.72 * (t.fall[i] as number)) * 0.5,
        0.22,
      )
      const hx = (-ty / len) * half
      const hy = (tx / len) * half
      left.push(x + hx, y + hy)
      right.push(x - hx, y - hy)
    }
    const rev: number[] = []
    for (let i = m - 1; i >= 0; i--) rev.push(right[i * 2] as number, right[i * 2 + 1] as number)
    const a = curved ? smooth(left, 0.5) : poly(left)
    const b = curved ? smooth(rev, 0.5) : poly(rev)
    if (!a || !b) return ''
    return `${a}${b.replace('M', 'L')}Z`
  }

  /**
   * Value, with the light in it.
   *
   * Every line used to sit at nearly the same alpha, so the field was a flat
   * texture with a soft middle. The classes are separated hard on the ramp,
   * and within a class the side of the eddy facing the light is pushed a tenth
   * up the ramp and the far side a tenth down — small, but it is what makes
   * the knot read as a form catching light rather than as a flat swirl.
   */
  const toneAt = (x: number, y: number, base: number): string => {
    const facing = Math.atan2(y - cy, x - cx)
    return ctx.ramp(clamp(base + (lit(ctx, facing) - 0.5) * 0.2, 0, 1))
  }

  /**
   * The haze: hairlines at a fifth of the alpha, behind everything.
   *
   * Every one of these carries its own multiplier on width, length and alpha.
   * Without them the field combs: the noise is smooth, so lines seeded near
   * each other run parallel for their whole length, and if they are also the
   * same length and the same value the result is a set of even bands. The
   * spread is what turns a comb back into a haze.
   */
  const hairs = Math.round(lerp(115, 280, densityK) * Math.max(0.35, ctx.quality ** 0.6))
  for (let i = 0; i < hairs; i++) {
    if ((i & 31) === 0 && ctx.expired()) break
    const x = field.range(-ctx.short * 0.12, w + ctx.short * 0.12)
    const y = field.range(-ctx.short * 0.12, h + ctx.short * 0.12)
    if (field.next() > ctx.density(x, y)) continue
    const fall = ctx.falloff(x, y)
    const long = field.range(0.4, 1.35)
    const steps = Math.max(6, Math.round(lerp(9, 26, flowK) * (0.3 + 0.9 * fall) * long))
    const t = through(x, y, Math.round(steps * 0.45), steps)
    const d = ribbon(t, u(lerp(0.45, 1.5, fall) * weightK) * field.range(0.6, 1.5), false)
    if (!d) continue
    behind.push(el('path', {
      d,
      fill: toneAt(x, y, 0.28 + 0.2 * fall),
      opacity: (0.11 + 0.24 * fall) * field.range(0.6, 1.4),
    }))
  }

  /**
   * The middle rank, and the marks that deny the silhouette.
   *
   * Two fifths of these are seeded within a hair of the focal boundary rather
   * than anywhere in the field. The compositor tints and rims the focal mask
   * whatever a renderer does, and a continuous rim around an untouched region
   * is the whole clip-art read; lines that walk across it in a dozen places
   * cut it into fragments, and a fragmented edge is a place where something is
   * happening rather than the outline of a symbol.
   */
  const mids = Math.round(lerp(32, 62, densityK))
  let placed = 0
  for (let tries = 0; placed < mids && tries < mids * 14; tries++) {
    if ((tries & 15) === 0 && ctx.expired()) break
    const a = skel.range(0, TAU)
    const onEdge = skel.next() < 0.4
    const rr = onEdge ? R * skel.range(0.86, 1.14) : R * Math.sqrt(skel.range(0.15, 3.4))
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    if (x < -margin * 0.4 || x > w + margin * 0.4) continue
    if (y < -margin * 0.4 || y > h + margin * 0.4) continue
    if (!onEdge && skel.next() > ctx.density(x, y) * 1.15) continue
    const fall = ctx.falloff(x, y)
    const t = through(x, y, 52, 60)
    const d = ribbon(t, u(lerp(1.6, 3.4, fall) * weightK) * skel.range(0.75, 1.3), false)
    if (!d) continue
    placed++
    front.push(el('path', {
      d, fill: toneAt(x, y, 0.5 + 0.18 * fall), opacity: 0.4 + 0.3 * fall,
    }))
  }

  /**
   * The gather: the pass that actually draws the subject.
   *
   * Density is the only honest way to say "the thing is here" in a field of
   * lines, and a field seeded uniformly over the canvas gives the subject
   * nothing but its share of the area. These are seeded inside the focal
   * radius and nowhere else, at a weight between the haze and the middle
   * rank, so the middle of the frame carries three or four times the ink of
   * the ground around it. It also buries the tint the compositor lays on the
   * mask, which is otherwise the flattest thing in the picture.
   */
  const gather = Math.round(lerp(55, 120, densityK) * Math.max(0.4, ctx.quality ** 0.6))
  for (let i = 0; i < gather; i++) {
    if ((i & 15) === 0 && ctx.expired()) break
    const a = field.range(0, TAU)
    const rr = R * 1.2 * Math.sqrt(field.next())
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    const fall = ctx.falloff(x, y)
    const t = through(x, y, 26, 32)
    const d = ribbon(t, u(lerp(0.9, 2.3, fall) * weightK) * field.range(0.6, 1.35), false)
    if (!d) continue
    front.push(el('path', {
      d, fill: toneAt(x, y, 0.4 + 0.2 * fall), opacity: (0.2 + 0.24 * fall) * field.range(0.7, 1.3),
    }))
  }

  // --- the leaders: seeded on a ring at the heart, traced out both ways ----
  const leadCount = skel.int(6, 9)
  const ring = R * skel.range(0.4, 0.78)
  const phase = skel.range(0, TAU)
  let longest: Trace | null = null
  let longestWidth = 0
  for (let i = 0; i < leadCount; i++) {
    if (ctx.expired()) break
    const a = phase + (i / leadCount) * TAU + skel.range(-0.3, 0.3)
    const rr = ring * skel.range(0.75, 1.3)
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    const t = through(x, y, 124, 64)
    if (t.fall.length < 24) continue
    const peak = u(lerp(5.6, 9.2, vortexK) * weightK) * skel.range(0.8, 1.25)
    const d = ribbon(t, peak, true)
    if (!d) continue
    front.push(el('path', {
      d, fill: toneAt(x, y, 0.93), opacity: 0.94,
    }))
    if (!longest || t.fall.length > longest.fall.length) {
      longest = t
      longestWidth = peak
    }
  }

  /**
   * The accent as the tip of a mark, not a dash laid across one.
   *
   * It used to be a second path drawn over whichever streamline came nearest
   * the middle, at its own width and its own opacity, which is how it read as
   * a lone bright dot with no relation to the field around it. Here the last
   * fifth of the longest leader is redrawn in the same ribbon, fading from the
   * top of the ramp into the accent along its own axis, so the bright thing in
   * the frame is the end of a line that has been travelling the whole time.
   * The compositor's bloom pass supplies the halo under it.
   */
  let accent: string | undefined
  if (longest) {
    const m = longest.fall.length
    const from = Math.max(0, Math.floor(m * 0.76))
    const tail: Trace = { pts: longest.pts.slice(from * 2), fall: longest.fall.slice(from) }
    const k = tail.fall.length
    if (k >= 4) {
      // The taper expects a whole line; re-flattening the tail's falloff keeps
      // the segment at full weight where it overlaps the leader it replaces.
      for (let i = 0; i < k; i++) tail.fall[i] = 1
      const d = ribbon(tail, longestWidth * 0.92, true)
      if (d) {
        const gid = `${ctx.uid}-tip`
        const x0 = tail.pts[0] as number
        const y0 = tail.pts[1] as number
        const x1 = tail.pts[(k - 1) * 2] as number
        const y1 = tail.pts[(k - 1) * 2 + 1] as number
        // The gradient goes in defs, not in the accent string: the compositor
        // draws the accent twice, once through the bloom filter, and a def
        // carried inline would be declared twice under the same id.
        defs.push(el('linearGradient',
          { id: gid, gradientUnits: 'userSpaceOnUse', x1: x0, y1: y0, x2: x1, y2: y1 },
          el('stop', { offset: '0', 'stop-color': ctx.ramp(0.9), 'stop-opacity': 0 }) +
          el('stop', { offset: '0.35', 'stop-color': ctx.ramp(0.92), 'stop-opacity': 0.9 }) +
          el('stop', { offset: '1', 'stop-color': palette.accent, 'stop-opacity': 1 })))
        accent = el('path', { d, fill: `url(#${gid})` })
      }
    }
  }

  /**
   * The second scale.
   *
   * One scale of detail was the last thing keeping this coarse: the eddy was
   * made of the same marks as the field around it, so getting closer showed
   * nothing new. These are lens-shaped dashes a few units long, laid on the
   * field direction inside the heart of the vortex — spray thrown off the
   * coil. Half of them go under the drawing and half over it: laid only
   * underneath they disappear behind three hundred ribbons, and laid only on
   * top they read as dirt rather than as texture belonging to the eddy.
   */
  const sprayN = Math.round(lerp(60, 150, densityK) * Math.max(0.4, ctx.quality ** 0.5))
  const sprayR = eddyR * 0.72
  for (let i = 0; i < sprayN; i++) {
    if ((i & 31) === 0 && ctx.expired()) break
    const a = field.range(0, TAU)
    const rr = sprayR * Math.sqrt(field.next())
    const x = cx + Math.cos(a) * rr
    const y = cy + Math.sin(a) * rr
    const dir = angleAt(x, y)
    const half = u(field.range(4, 12)) * (0.5 + 0.9 * flowK)
    const wide = u(field.range(0.4, 1.1)) * weightK
    const ux = Math.cos(dir)
    const uy = Math.sin(dir)
    const dash = el('path', {
      d: poly([
        x - ux * half, y - uy * half,
        x + uy * wide, y - ux * wide,
        x + ux * half, y + uy * half,
        x - uy * wide, y + ux * wide,
      ], true),
      fill: ctx.ramp(field.range(0.55, 0.98)),
      opacity: 0.12 + 0.24 * field.next(),
    })
    ;(field.bool() ? subject : front).push(dash)
  }

  /**
   * One line that never enters the eddy.
   *
   * Without it the composition is entirely centripetal and the empty six
   * tenths of the frame has nothing crossing it, which reads as unfinished
   * rather than as space. Seeded far out and run long, it passes through and
   * leaves — the counterweight that says the field extends past the picture.
   */
  const oa = skel.range(0, TAU)
  const od = R * skel.range(2.2, 3.4)
  const drifter = through(cx + Math.cos(oa) * od, cy + Math.sin(oa) * od, 130, 130)
  if (drifter.fall.length > 20) {
    const d = ribbon(drifter, u(2.4 * weightK), true)
    if (d) behind.push(el('path', { d, fill: withAlpha(ctx.ramp(0.62), 0.34) }))
  }

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const flowField: Renderer = {
  id: 'flow-field',
  name: 'Flow Field',
  family: 'organic',
  dark: true,
  focals: ['circle', 'ellipse', 'arch', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
