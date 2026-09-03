import { el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * One cord, knotted.
 *
 * The problem with drawing an interlace is deciding what passes over what, and
 * the usual answer is to compute the crossings and alternate them, which is
 * fiddly and goes wrong at tangencies. There is a much better one available:
 * take the cord off a shape that already has a third dimension.
 *
 * This is a torus knot. A point winds p times around the ring while winding q
 * times through the tube, which gives a closed curve that crosses itself a
 * known number of times — and, crucially, a height for every point on it. Draw
 * the cord in strands sorted by that height and the over-and-under falls out
 * for free, correct everywhere, with no crossing ever computed.
 *
 * The cord itself is drawn as a rope rather than a line: a dark casing, a lit
 * core offset toward the light, a highlight along the crown, and a shadow
 * dropped onto whatever it passes over. Those four passes are the difference
 * between braid and clip art.
 */

const schema: ParamSchema = [
  { key: 'winds', label: 'Turns', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'through', label: 'Crossings', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'thickness', label: 'Cord thickness', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.5 },
  { key: 'tube', label: 'Knot depth', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.55 },
  { key: 'strands', label: 'Ply', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'shadow', label: 'Shadow', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'diamond', 'disc'], default: 'auto' },
]

/** Coprime pairs, so the curve closes as one cord instead of several. */
const KNOTS: ReadonlyArray<readonly [number, number]> = [
  [2, 3], [3, 4], [2, 5], [3, 5], [4, 5], [2, 7], [3, 7], [5, 6], [4, 7], [5, 7],
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette, light, uid } = ctx
  const windsK = ctx.num('winds')
  const throughK = ctx.num('through')
  const thickK = ctx.num('thickness')
  const tubeK = ctx.num('tube')
  const plyK = ctx.num('strands')
  const shadowK = ctx.num('shadow')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const cx = focal.cx
  const cy = focal.cy
  const reach = Math.max(focal.rx, focal.ry)

  // pick the knot; the two sliders bias which end of the table we land in
  const pick = Math.min(
    KNOTS.length - 1,
    Math.round(lerp(0, KNOTS.length - 1, (windsK * 0.6 + throughK * 0.4)) + skel.range(-1.4, 1.4)),
  )
  const [p, q] = KNOTS[Math.max(0, pick)] as readonly [number, number]

  const R = reach * 0.6
  const rt = R * lerp(0.2, 0.5, tubeK)
  const spin = skel.range(0, Math.PI * 2)
  // a little perspective, so the ring is a ring seen from somewhere
  const squash = skel.range(0.62, 1)
  const tiltDeg = skel.range(-28, 28)

  const cordW = u(lerp(14, 52, thickK))

  defs.push(
    // along the cord's width: shadow side, lit crown, shadow side
    el('linearGradient',
      {
        id: `${uid}-cord`, gradientUnits: 'objectBoundingBox',
        x1: '0%', y1: '0%', x2: '0%', y2: '100%',
      },
      el('stop', { offset: '0%', 'stop-color': mixHex(ctx.ramp(0.2), palette.ink, 0.4) }) +
      el('stop', { offset: '38%', 'stop-color': ctx.ramp(0.9) }) +
      el('stop', { offset: '100%', 'stop-color': ctx.ramp(0.35) })),
  )

  // --- the curve -----------------------------------------------------------
  //
  // Sorting individual segments by depth does not work, and the reason is
  // worth stating: two segments from opposite sides of the knot can sit at the
  // same height, so a global sort interleaves them, and each one then paints
  // its dark casing over its neighbour's lit core. The result is a caterpillar.
  //
  // Sort continuous RUNS instead. Height along the cord is rt·sin(q·t), so the
  // curve splits into 2q stretches that each rise or fall monotonically — which
  // is exactly the set of strands the eye already sees. Each run is one
  // unbroken path, so there are no seams inside it, and the only joins are at
  // the height extrema, which is precisely where the cord is passing over or
  // under something and the join is invisible.
  const breaks: number[] = [0]
  for (let k = 0; ; k++) {
    const t = (Math.PI / 2 + k * Math.PI) / q
    if (t >= Math.PI * 2) break
    breaks.push(t)
  }
  breaks.push(Math.PI * 2)

  const at = (t: number) => {
    const rr = R + rt * Math.cos(q * t)
    return {
      x: cx + rr * Math.cos(p * t + spin),
      y: cy + rr * Math.sin(p * t + spin) * squash,
      z: rt * Math.sin(q * t),
    }
  }

  type Run = { d: string; z: number; lit: number }
  const runs: Run[] = []
  // runs overlap a little so the round caps close the join rather than meeting
  const lap = (Math.PI * 2) / (q * 48)

  for (let i = 0; i < breaks.length - 1; i++) {
    const t0 = (breaks[i] as number) - lap
    const t1 = (breaks[i + 1] as number) + lap
    const steps = Math.max(10, Math.round((t1 - t0) * p * 26))
    let d = ''
    let zsum = 0
    for (let sIdx = 0; sIdx <= steps; sIdx++) {
      const t = lerp(t0, t1, sIdx / steps)
      const q2 = at(t)
      d += `${sIdx === 0 ? 'M' : 'L'}${f(q2.x)} ${f(q2.y)}`
      zsum += q2.z
    }
    const z = zsum / (steps + 1)
    runs.push({ d, z, lit: 0.5 + 0.5 * (z / rt) })
  }
  runs.sort((a, b) => a.z - b.z)

  const rot = `rotate(${f(tiltDeg)} ${f(cx)} ${f(cy)})`
  const body: string[] = []

  for (const run of runs) {
    // The shadow goes immediately under its own run, not into a separate pass:
    // a run that passes beneath another must have that one's shadow ON it, and
    // batching all the shadows first would put every shadow under everything.
    if (shadowK > 0.02) {
      body.push(el('path', {
        d: run.d, fill: 'none',
        stroke: withAlpha(palette.ink, 0.34 * shadowK),
        'stroke-width': cordW * 1.15,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        transform: `translate(${f(cordW * 0.26 * light.dx)} ${f(cordW * 0.3)})`,
      }))
    }

    body.push(
      // casing
      el('path', {
        d: run.d, fill: 'none',
        stroke: mixHex(ctx.ramp(0.2), palette.ink, 0.35),
        'stroke-width': cordW,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }),
      // the cord, valued by how much of it faces up
      el('path', {
        d: run.d, fill: 'none',
        stroke: ctx.ramp(lerp(0.34, 0.95, run.lit)),
        'stroke-width': cordW * 0.78,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }),
      // the crown, offset toward the light across the cord's width
      el('path', {
        d: run.d, fill: 'none',
        stroke: withAlpha(ctx.ramp(1), 0.24 + 0.3 * run.lit),
        'stroke-width': cordW * 0.2,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        transform: `translate(${f(-cordW * 0.16 * light.dx)} ${f(-cordW * 0.18)})`,
      }),
    )

    // The ply: one fine line laid along the cord and shifted to its lower
    // edge. A cord without it is a tube, and a tube is not textile.
    if (plyK > 0.03) {
      body.push(el('path', {
        d: run.d, fill: 'none',
        stroke: withAlpha(palette.ink, 0.3 * plyK),
        'stroke-width': cordW * 0.09,
        'stroke-linecap': 'round',
        'stroke-dasharray': `${f(cordW * 0.5)} ${f(cordW * 0.34)}`,
        transform: `translate(0 ${f(cordW * 0.26)})`,
      }))
    }
  }

  subject.push(el('g', { transform: rot }, body.join('')))
  // the same knot outside the form, dimmer, so it does not stop at the edge
  behind.push(el('g', { transform: rot, opacity: 0.5 }, body.join('')))

  // --- the ground ----------------------------------------------------------
  // Concentric cord impressions, as if the knot were pressed into cloth.
  const rings = 5
  for (let i = 0; i < rings; i++) {
    const t = (i + 1) / rings
    back.push(el('ellipse', {
      cx, cy, rx: reach * lerp(1.1, 2.6, t), ry: reach * lerp(1.1, 2.6, t) * squash,
      fill: 'none',
      stroke: withAlpha(ctx.ramp(0.4), 0.22 * (1 - t * 0.6)),
      'stroke-width': u(lerp(4, 1.2, t)),
      transform: rot,
    }))
  }

  // --- the accent: the strand lying over all the others --------------------
  const top = runs[runs.length - 1] as Run
  const accent =
    el('g', { transform: rot },
      // A thread of colour laid along the top strand, not the strand repainted.
      // At full width the compositor's bloom turns it into a length of rope in
      // a different colour, which reads as a mistake rather than as an accent.
      el('path', {
        d: top.d, fill: 'none', stroke: withAlpha(palette.accent, 0.22),
        'stroke-width': cordW * 0.62, 'stroke-linecap': 'round',
        transform: `translate(${f(-cordW * 0.14 * light.dx)} ${f(-cordW * 0.16)})`,
      }) +
      el('path', {
        d: top.d, fill: 'none', stroke: palette.accent,
        'stroke-width': cordW * 0.16, 'stroke-linecap': 'round',
        transform: `translate(${f(-cordW * 0.14 * light.dx)} ${f(-cordW * 0.16)})`,
      }))

  return { back, behind, subject, front, defs, accent }
}

export const knotwork: Renderer = {
  id: 'knotwork',
  name: 'Knotwork',
  family: 'textile',
  dark: false,
  focals: ['circle', 'diamond', 'disc'],
  sampler: 'field',
  schema,
  render,
}
