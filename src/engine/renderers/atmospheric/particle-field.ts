import { el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Suspended particles, lit from one side.
 *
 * A field of equal dots reads as noise, so scale, opacity and streak length
 * all carry depth. That was already true; what was missing was that the marks
 * were hard-edged discs, and nothing in a real photograph of suspended dust is
 * hard-edged except the few motes in the focal plane.
 *
 * So the large marks are bokeh. A defocused point light does not blur into a
 * soft blob — it images the lens aperture, which is why out-of-focus highlights
 * come out as discs that are slightly DARKER in the middle than at the rim.
 * That rim is the whole tell, and it comes free from a radial gradient: no
 * filter, no per-mark cost, and it survives the 4x export unchanged.
 *
 * Three aperture gradients are shared across every mark in the frame, because
 * one per particle would be three thousand defs for a difference nobody can
 * see. The blur filter is spent only where it earns its region: on the handful
 * of foreground motes and the light shafts.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'turbulence', label: 'Drift', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.66 },
  { key: 'scale', label: 'Particle size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.45 },
  { key: 'streak', label: 'Streaks', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'bokeh', label: 'Bokeh', type: 'range', min: 0, max: 1, step: 0.01, default: 0.65 },
  { key: 'shafts', label: 'Light shafts', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'diamond', 'arch'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const field = ctx.rng
  const { w, h, u, n, focal, palette, light, uid } = ctx
  const densityK = ctx.num('density')
  const drift = ctx.num('turbulence')
  const scaleK = ctx.num('scale')
  const streakK = ctx.num('streak')
  const bokehK = ctx.num('bokeh')
  const shaftsK = ctx.num('shafts')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const bright = palette.ramp[palette.ramp.length - 1] as string

  // --- the aperture ---------------------------------------------------------
  // Three stops on one idea: the further a mote is from the focal plane, the
  // wider its disc and the more of its light sits in the rim rather than the
  // middle.
  const APERTURES = 3
  for (let k = 0; k < APERTURES; k++) {
    const t = k / (APERTURES - 1)
    // how much of the disc's light has migrated to the rim
    const ring = lerp(0.15, 0.85, t * bokehK)
    defs.push(el('radialGradient',
      { id: `${uid}-ap${k}`, gradientUnits: 'objectBoundingBox', cx: '50%', cy: '50%', r: '50%' },
      el('stop', { offset: '0%', 'stop-color': withAlpha(bright, 0.55 * (1 - ring * 0.55)) }) +
      el('stop', { offset: '62%', 'stop-color': withAlpha(bright, 0.45 * (1 - ring * 0.3)) }) +
      el('stop', { offset: '88%', 'stop-color': withAlpha(bright, 0.42 + 0.5 * ring) }) +
      el('stop', { offset: '97%', 'stop-color': withAlpha(bright, 0.3 * (1 - ring)) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(bright, 0) })))
  }

  defs.push(
    // a soft glow for a mote that is genuinely in front of the lens
    el('filter',
      {
        id: `${uid}-mote`, x: '-70%', y: '-70%', width: '240%', height: '240%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(11) })),
    // the shafts, which have to be soft along their whole length
    el('filter',
      {
        id: `${uid}-shaft`, x: '-25%', y: '-25%', width: '150%', height: '150%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(26) })),
    // a shaft falls off along its length rather than stopping at an edge
    el('linearGradient',
      { id: `${uid}-beam`, gradientUnits: 'objectBoundingBox', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
      el('stop', { offset: '0%', 'stop-color': withAlpha(bright, 0.22) }) +
      el('stop', { offset: '55%', 'stop-color': withAlpha(bright, 0.1) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(bright, 0) })),
  )

  // --- light shafts ---------------------------------------------------------
  // Parallel, from the one light source, and behind the particles so the dust
  // reads as being lit BY them rather than pasted over them.
  if (shaftsK > 0.02) {
    const shafts = Math.round(lerp(2, 6, shaftsK))
    const ang = Math.atan2(light.dy, light.dx) + Math.PI
    const deg = (ang * 180) / Math.PI - 90
    const reach = Math.hypot(w, h) * 1.2
    const beams: string[] = []
    for (let i = 0; i < shafts; i++) {
      const off = (i - (shafts - 1) / 2) * ctx.short * skel.range(0.16, 0.34)
      const wide = ctx.short * skel.range(0.05, 0.15) * (0.5 + shaftsK)
      beams.push(el('path', {
        d: `M${f(off - wide)} 0L${f(off + wide)} 0` +
          `L${f(off + wide * 2.6)} ${f(reach)}L${f(off - wide * 2.6)} ${f(reach)}Z`,
        fill: `url(#${uid}-beam)`,
      }))
    }
    back.push(el('g', {
      filter: `url(#${uid}-shaft)`,
      transform: `translate(${f(focal.cx)} ${f(focal.cy - reach * 0.45)}) rotate(${f(deg)})`,
    }, beams.join('')))
  }

  // --- the field ------------------------------------------------------------
  const count = Math.round(lerp(900, 3400, densityK) * Math.max(0.22, ctx.quality ** 0.7))
  const rBase = u(lerp(2.6, 9, scaleK))
  const bleed = ctx.short * 0.08

  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < count; i++) {
    if ((i & 127) === 0 && ctx.expired()) break
    const x = field.range(-bleed, w + bleed)
    const y = field.range(-bleed, h + bleed)
    if (field.next() > ctx.density(x, y)) continue
    const fall = ctx.falloff(x, y)

    // a cubed roll gives a few big particles among many small ones
    const mag = field.next() ** 3
    const r = rBase * (0.3 + 2.6 * mag) * (0.45 + 0.7 * fall)
    const tone = ctx.ramp(0.3 + 0.65 * (0.35 * mag + 0.65 * fall))
    const opacity = (0.3 + 0.55 * fall) * (0.5 + 0.5 * mag)

    let mark: string
    // Both bands are narrow on purpose. A bokeh disc is a highlight, and a
    // frame where one mark in seven is a highlight has no highlights in it.
    if (streakK > 0.03 && mag > 0.74 && mag < 0.93) {
      // motion, for the mid-sized marks: something moving is not a disc
      const a = ctx.fbm(n(x) * 0.0022, n(y) * 0.0022, 3) * Math.PI * 2 + drift * 2
      const len = r * lerp(1.6, 9, streakK) * fall
      mark = el('path', {
        d: `M${f(x)} ${f(y)}L${f(x + Math.cos(a) * len)} ${f(y + Math.sin(a) * len)}`,
        stroke: tone, 'stroke-width': r * 0.7, 'stroke-linecap': 'round',
        opacity, fill: 'none',
      })
    } else if (mag > 0.93 && bokehK > 0.02) {
      // Out of focus. The disc is much wider than the mote and carries its
      // light in the rim, which is what the eye reads as "close to the lens".
      const ap = Math.min(APERTURES - 1, Math.floor(mag * APERTURES * 1.35) % APERTURES)
      const rr = r * lerp(1.4, 5, bokehK)
      mark = el('circle', {
        cx: x, cy: y, r: rr,
        fill: `url(#${uid}-ap${ap})`,
        opacity: (0.4 + 0.5 * fall) * (0.5 + 0.5 * bokehK),
      })
    } else {
      mark = el('circle', { cx: x, cy: y, r, fill: tone, opacity })
    }

    subject.push(mark)
    if (field.next() < 0.4) (i % 13 === 6 ? behind : back).push(mark)

    const score = Math.hypot(x - focal.cx, y - focal.cy) / Math.max(mag, 0.05)
    if (score < accentScore && mag > 0.75) {
      accentScore = score
      accent =
        el('circle', { cx: x, cy: y, r: r * 1.5, fill: palette.accent }) +
        el('circle', {
          cx: x, cy: y, r: r * 4.5, fill: 'none',
          stroke: withAlpha(palette.accent, 0.45), 'stroke-width': u(1.2),
        }) +
        el('circle', {
          cx: x + u(5) * light.dx, cy: y - u(5) * light.dy, r: r * 4.5, fill: 'none',
          stroke: withAlpha(palette.accent, 0.2), 'stroke-width': u(1),
        })
    }
  }

  // --- the foreground -------------------------------------------------------
  // A handful of motes in front of the lens, blurred for real. Few enough that
  // the filter regions stay small, and they are what puts the rest of the
  // frame behind glass.
  const nearMotes = Math.round(lerp(3, 11, bokehK))
  const close: string[] = []
  for (let i = 0; i < nearMotes; i++) {
    const x = skel.range(-bleed, w + bleed)
    const y = skel.range(-bleed, h + bleed)
    const rr = ctx.short * skel.range(0.03, 0.1)
    close.push(el('circle', {
      cx: x, cy: y, r: rr,
      fill: `url(#${uid}-ap${APERTURES - 1})`,
      opacity: 0.5 + 0.35 * skel.next(),
    }))
  }
  front.push(el('g', { filter: `url(#${uid}-mote)` }, close.join('')))

  // a long drift line crossing the mask edge and leaving the frame
  const ang = skel.range(0, Math.PI * 2)
  const reach = ctx.short * 1.3
  front.push(el('path', {
    d: `M${f(focal.cx - Math.cos(ang) * reach)} ${f(focal.cy - Math.sin(ang) * reach)}` +
      `L${f(focal.cx + Math.cos(ang) * reach)} ${f(focal.cy + Math.sin(ang) * reach)}`,
    stroke: withAlpha(mixHex(ctx.ramp(1), palette.ground, 0.15), 0.4),
    'stroke-width': u(1.4), fill: 'none',
  }))

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const particleField: Renderer = {
  id: 'particle-field',
  name: 'Particle Field',
  family: 'atmospheric',
  dark: true,
  focals: ['circle', 'ellipse', 'diamond', 'arch'],
  sampler: 'field',
  schema,
  render,
}
