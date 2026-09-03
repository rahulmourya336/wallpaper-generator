import { circlePath, el, f, lerp } from '../../svg'
import { mixHex, toward, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A planet disc with a ring system.
 *
 * The occlusion is the structure: half of each ellipse passes behind the disc
 * and half crosses in front of it, and that alone does more for depth than any
 * amount of shading.
 *
 * Everything else here is light. A planet is a sphere, so it has a terminator
 * rather than a set of concentric bands, and the shading has to run across the
 * disc from the light and not outward from the middle — that one change is the
 * difference between a sphere and a target. Above it sit the two details that
 * make a ringed planet read as photographed rather than diagrammed: the rings
 * throw their own shadow onto the disc, and the disc throws its shadow back
 * across the rings on the far side. Both are cheap; both are the first thing
 * the eye checks.
 *
 * The atmosphere is a limb glow, brightest where the star is, which is the
 * only place a thin shell is edge-on enough to see through.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Ring count', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'tilt', label: 'Ring tilt', type: 'range', min: 0.04, max: 0.6, step: 0.01, default: 0.22 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'stars', label: 'Stars', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'spread', label: 'Ring spread', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'belts', label: 'Cloud belts', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'disc', 'circle'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const starRng = ctx.fork('stars')
  const { w, h, u, focal, palette, light, uid } = ctx
  const densityK = ctx.num('density')
  const tilt = ctx.num('tilt')
  const starsK = ctx.num('stars')
  const spread = ctx.num('spread')
  const beltsK = ctx.num('belts')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const R = Math.max(focal.rx, focal.ry)
  const cx = focal.cx
  const cy = focal.cy
  const rot = skel.range(-22, 22)

  // where the star is, as a direction on the disc
  const lx = -light.dx
  const ly = light.dy

  // --- defs ----------------------------------------------------------------
  defs.push(
    // The limb. Offset toward the star so the bright pole sits on the lit side
    // and the terminator falls where the sphere turns away, instead of the
    // disc lighting up from its own centre.
    el('radialGradient',
      {
        id: `${uid}-limb`, gradientUnits: 'userSpaceOnUse',
        cx: cx + lx * R * 0.55, cy: cy + ly * R * 0.55, r: R * 1.72,
      },
      el('stop', { offset: '0%', 'stop-color': ctx.ramp(0.92) }) +
      el('stop', { offset: '26%', 'stop-color': ctx.ramp(0.62) }) +
      el('stop', { offset: '58%', 'stop-color': ctx.ramp(0.3) }) +
      el('stop', { offset: '100%', 'stop-color': mixHex(ctx.ramp(0.14), palette.ink, 0.55) })),

    // the shell, seen edge-on at the limb and brightest toward the star
    el('radialGradient',
      { id: `${uid}-atmo`, gradientUnits: 'userSpaceOnUse', cx, cy, r: R * 1.3 },
      el('stop', { offset: '0%', 'stop-color': withAlpha(palette.accent, 0) }) +
      el('stop', { offset: '74%', 'stop-color': withAlpha(palette.accent, 0) }) +
      el('stop', { offset: '80%', 'stop-color': withAlpha(ctx.ramp(1), 0.34) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(ctx.ramp(0.8), 0) })),

    // the disc, so the ring shadow and the belts can be cut to it
    el('clipPath', { id: `${uid}-disc`, clipPathUnits: 'userSpaceOnUse' },
      el('circle', { cx, cy, r: R })),

    // the night mask: transparent at the sub-stellar point, opaque behind it
    el('radialGradient',
      {
        id: `${uid}-nightg`, gradientUnits: 'userSpaceOnUse',
        cx: cx + lx * R * 0.45, cy: cy + ly * R * 0.45, r: R * 1.85,
      },
      el('stop', { offset: '12%', 'stop-color': '#000000' }) +
      el('stop', { offset: '52%', 'stop-color': '#4d4d4d' }) +
      el('stop', { offset: '100%', 'stop-color': '#ffffff' })),
    el('mask', { id: `${uid}-night`, maskUnits: 'userSpaceOnUse' },
      el('circle', { cx, cy, r: R, fill: `url(#${uid}-nightg)` })),

    // a small blur for the handful of bright stars; per-star, so each region
    // is a few pixels across rather than the whole frame
    el('filter',
      {
        id: `${uid}-star`, x: '-180%', y: '-180%', width: '460%', height: '460%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(3.4) })),
  )

  // --- starfield -----------------------------------------------------------
  if (starsK > 0.02) {
    const count = Math.round(lerp(160, 620, starsK) * Math.max(0.3, ctx.quality ** 0.6))
    for (let i = 0; i < count; i++) {
      const x = starRng.range(-u(20), w + u(20))
      const y = starRng.range(-u(20), h + u(20))
      const mag = starRng.next() ** 3.2
      const fall = ctx.falloff(x, y)
      const r = u(0.7 + 5 * mag) * (0.5 + 0.6 * fall)
      back.push(el('circle', {
        cx: x, cy: y, r,
        fill: ctx.ramp(0.5 + 0.5 * mag),
        opacity: (0.25 + 0.55 * mag) * (0.45 + 0.55 * fall),
      }))

      // The brightest few get a halo and a pair of diffraction spikes. A field
      // of equal dots reads as dust; a magnitude spread reads as sky, and the
      // spikes are what the eye takes as "bright" rather than "near".
      if (mag > 0.82) {
        const flare = r * lerp(4, 11, mag)
        back.push(
          el('circle', {
            cx: x, cy: y, r: r * 2.6, fill: withAlpha(ctx.ramp(1), 0.5),
            filter: `url(#${uid}-star)`,
          }),
          el('path', {
            d: `M${f(x - flare)} ${f(y)}H${f(x + flare)}M${f(x)} ${f(y - flare)}V${f(y + flare)}`,
            stroke: withAlpha(ctx.ramp(1), 0.34 * mag),
            'stroke-width': r * 0.55, 'stroke-linecap': 'round', fill: 'none',
          }),
        )
      }
    }
  }

  // --- the ring system -----------------------------------------------------
  const rings = Math.round(lerp(9, 34, densityK))
  const inner = R * 1.22
  const outer = R * (1.7 + 1.5 * spread)
  const spin = `rotate(${f(rot)} ${f(cx)} ${f(cy)})`

  const ringArc = (rx: number, upper: boolean) => {
    const ry = rx * tilt
    return (
      `M${f(cx - rx)} ${f(cy)}` +
      `A${f(rx)} ${f(ry)} 0 0 ${upper ? 1 : 0} ${f(cx + rx)} ${f(cy)}`
    )
  }

  // The planet's own shadow, thrown across the far rings away from the star.
  // Drawn as a wedge over the ring band, and the reason the far side of a real
  // ring system always has a bite taken out of it.
  const shadowSide = lx > 0 ? -1 : 1
  behind.push(el('path', {
    d: `M${f(cx)} ${f(cy)}` +
      `L${f(cx + shadowSide * outer * 1.06)} ${f(cy - outer * tilt * 1.5)}` +
      `L${f(cx + shadowSide * outer * 1.06)} ${f(cy + outer * tilt * 1.5)}Z`,
    fill: withAlpha(palette.ink, 0.5),
    transform: spin,
  }))

  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1)
    const rx = lerp(inner, outer, t) * skel.range(0.99, 1.01)
    const fall = ctx.falloff(cx + rx, cy)
    if (skel.bool(0.16)) continue
    const width = u(lerp(1, 4.5, 1 - t) * (0.5 + 0.7 * fall))
    const tone = ctx.ramp(0.34 + 0.5 * fall * (0.5 + 0.5 * (1 - t)))
    const opacity = 0.35 + 0.5 * fall

    behind.push(el('path', {
      d: ringArc(rx, true), fill: 'none', stroke: tone, 'stroke-width': width,
      opacity, transform: spin,
    }))
    front.push(el('path', {
      d: ringArc(rx, false), fill: 'none', stroke: tone, 'stroke-width': width,
      opacity: opacity * 1.15, transform: spin,
    }))
  }

  // --- the planet ----------------------------------------------------------
  subject.push(el('path', { d: circlePath(cx, cy, R), fill: `url(#${uid}-limb)` }))

  // Cloud belts: ellipses across the disc rather than circles around its
  // centre. Concentric rings on a sphere are a target; latitude bands are
  // weather, and they cost the same.
  if (beltsK > 0.02) {
    const belts = Math.round(lerp(3, 11, beltsK))
    const bandTilt = skel.range(-14, 14)
    const belted: string[] = []
    for (let i = 0; i < belts; i++) {
      const t = (i + 0.5) / belts
      // latitude, so the band narrows toward the poles
      const yOff = (t - 0.5) * 2 * R
      const halfW = Math.sqrt(Math.max(0, R * R - yOff * yOff))
      const thick = (R / belts) * skel.range(0.45, 1.1)
      belted.push(el('ellipse', {
        cx, cy: cy + yOff, rx: halfW * 1.02, ry: thick,
        fill: withAlpha(i % 2 === 0 ? ctx.ramp(0.9) : palette.ink, 0.14 + 0.12 * beltsK),
      }))
    }
    subject.push(el('g', {
      'clip-path': `url(#${uid}-disc)`,
      transform: `rotate(${f(bandTilt)} ${f(cx)} ${f(cy)})`,
    }, belted.join('')))
  }

  // The ring shadow on the planet: the same ellipses, squashed onto the disc
  // and offset away from the star. This is the detail that says the rings are
  // a physical plane and not a decoration painted round the edge.
  const shadow: string[] = []
  const shadowDrop = -ly * R * lerp(0.22, 0.6, tilt * 1.6)
  for (let i = 0; i < 7; i++) {
    const t = i / 6
    const rx = lerp(inner, outer * 0.86, t)
    shadow.push(el('path', {
      d: ringArc(rx, false),
      fill: 'none',
      stroke: withAlpha(palette.ink, 0.42 * (1 - t * 0.5)),
      'stroke-width': u(lerp(9, 3, t)),
      transform: `translate(0 ${f(shadowDrop)})`,
    }))
  }
  subject.push(el('g', { 'clip-path': `url(#${uid}-disc)`, transform: spin }, shadow.join('')))

  // The night side. A sphere does not fade to its own ramp at its edge, it
  // falls into shadow on the side facing away from the star, so the darkening
  // is offset rather than concentric. Done with an SVG mask rather than a CSS
  // one: the export rasterises through an <img>, and a CSS mask-image is not
  // something every path to a bitmap honours.
  subject.push(el('path', {
    d: circlePath(cx, cy, R),
    fill: withAlpha(palette.ink, 0.62),
    mask: `url(#${uid}-night)`,
  }))

  // the shell, glowing at the limb
  behind.push(el('circle', { cx, cy, r: R * 1.3, fill: `url(#${uid}-atmo)` }))

  // --- the accent: the lit limb --------------------------------------------
  const la = Math.atan2(ly, lx)
  const a0 = la - 1.15
  const a1 = la + 1.15
  const limbArc = (rr: number) =>
    `M${f(cx + Math.cos(a0) * rr)} ${f(cy + Math.sin(a0) * rr)}` +
    `A${f(rr)} ${f(rr)} 0 0 1 ${f(cx + Math.cos(a1) * rr)} ${f(cy + Math.sin(a1) * rr)}`

  const accent =
    el('path', {
      d: limbArc(R), fill: 'none', stroke: palette.accent, 'stroke-width': u(5),
      'stroke-linecap': 'round',
    }) +
    el('path', {
      d: limbArc(R + u(9)), fill: 'none',
      stroke: withAlpha(palette.accent, 0.35), 'stroke-width': u(1.6),
    }) +
    el('path', {
      d: limbArc(R - u(7)), fill: 'none',
      stroke: withAlpha(toward(palette, palette.accent, 0.35), 0.5), 'stroke-width': u(2.4),
      'stroke-linecap': 'round',
    })

  return { back, behind, subject, front, defs, accent }
}

export const eclipseRings: Renderer = {
  id: 'eclipse-rings',
  name: 'Eclipse Rings',
  family: 'cosmic',
  dark: true,
  focals: ['disc', 'circle'],
  sampler: 'field',
  schema,
  render,
}
