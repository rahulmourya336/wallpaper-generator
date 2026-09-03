import { hexToRgb, withAlpha } from './palette'
import type { Palette } from './palette'
import { el, ellipsePath, f } from './svg'
import type { RenderContext } from './types'
import type { LayoutPlan } from './layout'
import type { Character } from './character'

/**
 * Light, depth and atmosphere.
 *
 * The compositor produced flat vector: hairlines and solid fills on a solid
 * ground, one grain overlay, one vignette. Technically clean, and it reads as
 * a diagram rather than a wallpaper — there is no light in it anywhere.
 *
 * The original brief warned that a Gaussian blur at 4x export is slow to
 * rasterize, and that is true of a blur over the whole frame. It is not true of
 * a blur over a handful of large shapes: an SVG filter costs its own region,
 * so five blurred ellipses cost five small regions no matter how many elements
 * sit above them. Everything here is built on that distinction, which is what
 * makes bloom and soft colour affordable at export size.
 *
 * Blur radii are given in design units, so they scale with the render and the
 * 4x export looks like the preview rather than sharper.
 */

/** Screen lifts on a dark ground; on a light one it does nothing, so multiply. */
function lightenBlend(p: Palette): string {
  return p.mode === 'light' ? 'multiply' : 'screen'
}

export function lightDefs(ctx: RenderContext, uid: string, character: Character): string[] {
  const { u } = ctx
  return [
    // wide soft blur for the colour wash behind everything
    el('filter',
      {
        id: `${uid}-soft`, x: '-35%', y: '-35%', width: '170%', height: '170%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(70) })),

    // bloom: blur the source and push its alpha up so the halo actually reads
    el('filter',
      {
        id: `${uid}-bloom`, x: '-60%', y: '-60%', width: '220%', height: '220%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(9 * character.bloom), result: 'b' }) +
      el('feComponentTransfer', { in: 'b' },
        el('feFuncA', { type: 'linear', slope: 1.9 }))),

    // the subject sits above the field, so it casts
    el('filter',
      {
        id: `${uid}-cast`, x: '-25%', y: '-25%', width: '150%', height: '150%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feDropShadow', {
        dx: u(6) * -ctx.light.dx,
        dy: u(9),
        stdDeviation: u(14),
        'flood-color': ctx.palette.ink,
        'flood-opacity': 0.55,
      })),

    // a lighter touch for elements that cross in front
    el('filter',
      {
        id: `${uid}-lift`, x: '-25%', y: '-25%', width: '150%', height: '150%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feDropShadow', {
        dx: u(3) * -ctx.light.dx,
        dy: u(5),
        stdDeviation: u(7),
        'flood-color': ctx.palette.ink,
        'flood-opacity': 0.45,
      })),
  ]
}

/**
 * Large blurred colour fields behind the artwork.
 *
 * This is the whole difference between a flat ground and one that feels lit.
 * Five ellipses, blurred hard, in the palette's own colours: a mesh gradient
 * built out of shapes, which costs five small filter regions rather than a
 * full-frame pass.
 */
export function atmosphere(
  ctx: RenderContext,
  uid: string,
  plan: LayoutPlan,
  character: Character,
): string {
  if (character.atmosphere <= 0) return ''
  const rng = ctx.fork('atmosphere')
  const { w, h, short, palette: p } = ctx
  const blobs: string[] = []
  const count = 5

  for (let i = 0; i < count; i++) {
    // one blob always sits under the subject so the focal area glows
    const onSubject = i === 0
    const cx = onSubject ? plan.screen.cx : rng.range(-0.1, 1.1) * w
    const cy = onSubject ? plan.screen.cy : rng.range(-0.05, 1.05) * h
    const rx = short * rng.range(0.35, 0.8)
    const ry = rx * rng.range(0.6, 1.35)
    const tone = i % 3 === 0 ? p.accent : ctx.ramp(rng.range(0.55, 1))
    const alpha = (onSubject ? 0.3 : rng.range(0.12, 0.26)) * character.atmosphere
    blobs.push(el('path', { d: ellipsePath(cx, cy, rx, ry), fill: withAlpha(tone, alpha) }))
  }

  return el('g',
    { filter: `url(#${uid}-soft)`, style: `mix-blend-mode:${lightenBlend(p)}` },
    blobs.join(''))
}

/**
 * A broad specular sweep from the composition's own light direction. One
 * element, and it is what stops the frame reading as evenly lit.
 */
export function sheen(ctx: RenderContext, uid: string, character: Character): string {
  if (character.sheen <= 0) return ''
  const { w, h, short, palette: p, light } = ctx
  const cx = w * 0.5 + light.dx * short * 0.55
  const cy = h * 0.5 + light.dy * short * 0.55
  const rgb = hexToRgb(p.mode === 'light' ? p.ink : ctx.ramp(1))
  const peak = (p.mode === 'light' ? 0.1 : 0.22) * character.sheen

  return (
    el('radialGradient',
      { id: `${uid}-sheen`, gradientUnits: 'userSpaceOnUse', cx, cy, r: short * 1.15 },
      el('stop', { offset: '0', 'stop-color': `rgb(${rgb.r},${rgb.g},${rgb.b})`, 'stop-opacity': peak.toFixed(3) }) +
      el('stop', { offset: '1', 'stop-color': `rgb(${rgb.r},${rgb.g},${rgb.b})`, 'stop-opacity': 0 })) +
    el('rect', {
      x: 0, y: 0, width: w, height: h,
      fill: `url(#${uid}-sheen)`,
      style: `mix-blend-mode:${lightenBlend(p)}`,
    })
  )
}

/** A ground that is lit rather than filled: the palette's own colours, softened. */
export function groundFill(ctx: RenderContext, uid: string): string {
  const { w, h, palette: p } = ctx
  const warm = ctx.ramp(0.34)
  return (
    el('linearGradient',
      { id: `${uid}-ground`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 0, y2: h },
      el('stop', { offset: '0', 'stop-color': p.mode === 'light' ? warm : p.ink }) +
      el('stop', { offset: '0.45', 'stop-color': p.ground }) +
      el('stop', { offset: '1', 'stop-color': p.mode === 'light' ? p.ground : warm })) +
    el('rect', { x: 0, y: 0, width: w, height: h, fill: `url(#${uid}-ground)` })
  )
}

/** The accent, with its halo underneath it. */
export function bloomed(accent: string, uid: string, character: Character): string {
  if (character.bloom <= 0) return accent
  return (
    el('g', { filter: `url(#${uid}-bloom)`, style: 'mix-blend-mode:screen' }, accent) +
    accent
  )
}

void f
