import { hexToRgb, mixHex, withAlpha } from './palette'
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
    // The region has to be given in user space over the whole canvas. On the
    // bounding box it was -35%..135%, and with a 30px blur the tail ran past
    // the region and got hard-clipped, which is where the vertical seam down
    // the side of the atmosphere layer came from.
    el('filter',
      {
        id: `${uid}-soft`,
        filterUnits: 'userSpaceOnUse',
        x: -ctx.w, y: -ctx.h, width: ctx.w * 3, height: ctx.h * 3,
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
  const { w, h, short, palette: p, light } = ctx

  // Light comes from somewhere. Three masses, each with a reason to exist: the
  // source, the subject it falls on, and the air between. Five blobs at random
  // positions average out to fog, and fog is the one thing that guarantees a
  // flat picture.
  //
  // Dark palettes take less. They begin near the bottom of the value range,
  // which is their whole appeal, and a lift sized for a light ground spends it.
  const gain = (p.mode === 'dark' ? 0.55 : 1) * character.atmosphere
  const srcX = w * 0.5 + light.dx * short * 0.85
  const srcY = h * 0.5 + light.dy * short * 0.85

  const blobs = [
    { cx: srcX, cy: srcY, rx: short * 0.95, ry: short * 0.8, tone: ctx.ramp(0.92), a: 0.26 },
    { cx: plan.screen.cx, cy: plan.screen.cy, rx: short * 0.6, ry: short * 0.66, tone: p.accent, a: 0.16 },
    {
      cx: (srcX + plan.screen.cx) * 0.5,
      cy: (srcY + plan.screen.cy) * 0.5,
      rx: short * 0.7, ry: short * 0.55, tone: ctx.ramp(0.6), a: 0.13,
    },
  ]

  return el('g',
    { filter: `url(#${uid}-soft)`, style: `mix-blend-mode:${lightenBlend(p)}` },
    blobs
      .map((b) => el('path', {
        d: ellipsePath(b.cx, b.cy, b.rx, b.ry),
        fill: withAlpha(b.tone, b.a * gain),
      }))
      .join(''))
}

/**
 * The other half of the light model, and the half that was missing.
 *
 * Everything else here blends `screen`. With no counterpart the deep grounds
 * get lifted by every pass that touches them and the frame settles into the
 * middle of its own value range, which is what "bland" is. This is one soft
 * mass in the quadrant the light does not reach, multiplied, so a composition
 * has somewhere genuinely dark to sit against.
 */
export function shade(ctx: RenderContext, uid: string, character: Character): string {
  if (character.atmosphere <= 0) return ''
  const { w, h, short, palette: p, light } = ctx
  const depth = (p.mode === 'light' ? 0.2 : 0.45) * character.atmosphere

  return el('g',
    { filter: `url(#${uid}-soft)`, style: 'mix-blend-mode:multiply' },
    el('path', {
      d: ellipsePath(
        w * 0.5 - light.dx * short * 0.9,
        h * 0.5 - light.dy * short * 0.9,
        short * 1.15, short * 1.0,
      ),
      fill: withAlpha(p.ink, depth),
    }))
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
  const peak = (p.mode === 'light' ? 0.12 : 0.3) * character.sheen

  return (
    el('radialGradient',
      { id: `${uid}-sheen`, gradientUnits: 'userSpaceOnUse', cx, cy, r: short * 0.72 },
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
  const { w, h, short, palette: p, light } = ctx

  // A vertical ramp on every style is why forty-three of them read as
  // siblings. Running the axis along the light means the ground says where the
  // light is before anything is drawn on it, and no two angles ground alike.
  const lit = p.mode === 'light' ? mixHex(p.ground, '#FFFFFF', 0.3) : ctx.ramp(0.26)
  const dark = p.mode === 'light' ? ctx.ramp(0.22) : mixHex(p.ink, '#000000', 0.3)

  return (
    el('linearGradient',
      {
        id: `${uid}-ground`, gradientUnits: 'userSpaceOnUse',
        x1: w * 0.5 + light.dx * short * 1.1, y1: h * 0.5 + light.dy * short * 1.1,
        x2: w * 0.5 - light.dx * short * 1.1, y2: h * 0.5 - light.dy * short * 1.1,
      },
      el('stop', { offset: '0', 'stop-color': lit }) +
      el('stop', { offset: '0.42', 'stop-color': p.ground }) +
      el('stop', { offset: '1', 'stop-color': dark })) +
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
