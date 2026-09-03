import { circlePath, el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Soap foam.
 *
 * The other two styles in this family draw cells as outlines, which is the
 * diagram of a cell rather than the thing. A bubble is not an outline: it is a
 * curved transparent film, and everything you recognise about one is light
 * doing something to that film.
 *
 * Four things, and all four are needed — drop any one and it goes back to
 * being a circle. The film is thin enough to interfere, so its colour shifts
 * across the surface. It is transparent, so the ground shows through the
 * middle and the colour piles up at the rim where you are looking through the
 * most film. It is convex, so it carries a small hard specular where the light
 * source reflects. And it is a lens, so there is a second, dimmer highlight
 * on the far side where light has come through and bounced back.
 *
 * Bubbles are packed until they touch and then a little further, because a
 * foam is defined by its shared walls. Overlapping rims read as those walls
 * without any of the geometry it would take to compute them properly.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Bubbles', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'spread', label: 'Size range', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.55 },
  { key: 'iridescence', label: 'Iridescence', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'film', label: 'Film thickness', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.5 },
  { key: 'specular', label: 'Specular', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'depth', label: 'Depth of field', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'disc'], default: 'auto' },
]

type Bubble = { x: number; y: number; r: number; hue: number; plane: number }

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette, light, uid } = ctx
  const densityK = ctx.num('density')
  const spreadK = ctx.num('spread')
  const irisK = ctx.num('iridescence')
  const filmK = ctx.num('film')
  const specK = ctx.num('specular')
  const depthK = ctx.num('depth')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const bright = palette.ramp[palette.ramp.length - 1] as string

  // --- the film ------------------------------------------------------------
  // Interference shifts the film's colour with its thickness, and thickness
  // varies over a real bubble. A handful of shared gradients stands in for a
  // continuum; the eye reads the variation between neighbours, not within one.
  const FILMS = 5
  for (let k = 0; k < FILMS; k++) {
    const t = k / (FILMS - 1)
    // Each film sits at a different point on the ramp and leans a different
    // amount toward the accent, which is as much hue as a palette of one
    // colour family can honestly give.
    const core = mixHex(ctx.ramp(lerp(0.35, 0.95, t)), palette.accent, irisK * lerp(0.05, 0.5, t))
    const edge = mixHex(ctx.ramp(lerp(0.9, 0.45, t)), palette.accent, irisK * lerp(0.45, 0.1, t))
    defs.push(el('radialGradient',
      {
        id: `${uid}-film${k}`, gradientUnits: 'objectBoundingBox',
        cx: f(50 - light.dx * 16) + '%', cy: f(50 - light.dy * 16) + '%', r: '62%',
      },
      // transparent through the middle: you are looking through two films and
      // whatever is behind them
      el('stop', { offset: '0%', 'stop-color': withAlpha(core, 0.1 + 0.16 * filmK) }) +
      el('stop', { offset: '55%', 'stop-color': withAlpha(core, 0.2 + 0.24 * filmK) }) +
      // and the rim, where the line of sight runs along the film
      el('stop', { offset: '86%', 'stop-color': withAlpha(edge, 0.42 + 0.4 * filmK) }) +
      el('stop', { offset: '97%', 'stop-color': withAlpha(bright, 0.5 + 0.4 * filmK) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(edge, 0.25) })))
  }

  defs.push(
    el('filter',
      {
        id: `${uid}-far`, x: '-15%', y: '-15%', width: '130%', height: '130%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(lerp(0.5, 13, depthK)) })),
    el('filter',
      {
        id: `${uid}-near`, x: '-20%', y: '-20%', width: '140%', height: '140%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(lerp(0.8, 22, depthK)) })),
  )

  // --- packing -------------------------------------------------------------
  // Dart-throwing, but with the rejection radius set BELOW the sum of the two
  // radii, so bubbles are required to overlap. Packed to touching and no
  // further you get a pile of circles; a foam is the overlap.
  const reach = Math.max(focal.rx, focal.ry)
  const target = Math.round(lerp(26, 130, densityK))
  const rMax = reach * lerp(0.52, 0.3, densityK)
  const rMin = rMax * lerp(0.55, 0.13, spreadK)
  const bubbles: Bubble[] = []
  const tries = target * 26

  for (let i = 0; i < tries && bubbles.length < target; i++) {
    if ((i & 63) === 0 && ctx.expired()) break
    const x = skel.range(-reach * 0.5, w + reach * 0.5)
    const y = skel.range(-reach * 0.5, h + reach * 0.5)
    // bias size toward the subject, so the foam has a focus
    const fall = ctx.falloff(x, y)
    const r = lerp(rMin, rMax, skel.next() ** 1.7) * (0.55 + 0.6 * fall)

    let ok = true
    for (const b of bubbles) {
      // allow a real overlap: this is the shared wall
      if (Math.hypot(b.x - x, b.y - y) < (b.r + r) * 0.72) { ok = false; break }
    }
    if (!ok) continue
    bubbles.push({ x, y, r, hue: skel.int(0, FILMS - 1), plane: skel.next() })
  }

  // --- drawing -------------------------------------------------------------
  const farPlane: string[] = []
  const nearPlane: string[] = []
  let accent: string | undefined
  let bestScore = Infinity

  for (const b of bubbles) {
    const fall = ctx.falloff(b.x, b.y)
    const d = circlePath(b.x, b.y, b.r)

    // the specular: small, hard, and on the side the light comes from
    const sx = b.x - light.dx * b.r * 0.52
    const sy = b.y - light.dy * b.r * 0.52
    // and the bounce: bigger, softer, opposite, and never as bright
    const bx = b.x + light.dx * b.r * 0.46
    const by = b.y + light.dy * b.r * 0.46

    const parts =
      el('path', { d, fill: `url(#${uid}-film${b.hue})` }) +
      // the wall itself, which is where two films are pressed together
      el('path', {
        d, fill: 'none',
        stroke: withAlpha(bright, 0.3 + 0.35 * fall),
        'stroke-width': u(lerp(1, 3.4, filmK)),
      }) +
      el('ellipse', {
        cx: sx, cy: sy, rx: b.r * 0.17, ry: b.r * 0.11,
        fill: withAlpha(bright, 0.6 * specK),
        transform: `rotate(${f((Math.atan2(light.dy, light.dx) * 180) / Math.PI + 90)} ${f(sx)} ${f(sy)})`,
      }) +
      el('circle', {
        cx: bx, cy: by, r: b.r * 0.24,
        fill: withAlpha(bright, 0.14 * specK),
      })

    if (b.plane < 0.22) farPlane.push(parts)
    else if (b.plane > 0.93) nearPlane.push(parts)
    else subject.push(parts)

    // an accent bubble: near the subject, and large enough to carry it
    const score = Math.hypot(b.x - focal.cx, b.y - focal.cy) - b.r * 1.5
    if (score < bestScore && b.plane >= 0.22 && b.plane <= 0.93) {
      bestScore = score
      accent =
        el('path', {
          d, fill: 'none', stroke: palette.accent, 'stroke-width': u(3),
        }) +
        el('ellipse', {
          cx: sx, cy: sy, rx: b.r * 0.13, ry: b.r * 0.085,
          fill: palette.accent,
          transform: `rotate(${f((Math.atan2(light.dy, light.dx) * 180) / Math.PI + 90)} ${f(sx)} ${f(sy)})`,
        })
    }
  }

  // The out-of-focus planes. Both go behind and in front respectively, which
  // is the whole reason the middle of the frame reads as a plane you could
  // reach into rather than a pattern printed on the ground.
  const far = el('g', { filter: `url(#${uid}-far)`, opacity: 0.8 }, farPlane.join(''))
  back.push(far)
  behind.push(el('g', { opacity: 0.65 }, far))
  front.push(el('g', { filter: `url(#${uid}-near)`, opacity: 0.7 }, nearPlane.join('')))

  // the wet ground the foam sits on, so it is not floating in the dark
  behind.push(el('ellipse', {
    cx: focal.cx, cy: focal.cy + reach * 0.3, rx: reach * 2.2, ry: reach * 1.5,
    fill: withAlpha(mixHex(palette.ground, ctx.ramp(0.4), 0.4), 0.5),
  }))

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const foam: Renderer = {
  id: 'foam',
  name: 'Foam',
  family: 'cellular',
  dark: true,
  focals: ['circle', 'ellipse', 'disc'],
  sampler: 'field',
  schema,
  render,
}
