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
 *
 * Which light vector a pass reads is load-bearing. `ctx.light` is the light in
 * the field's frame and belongs to anything drawn inside the layout transform;
 * `ctx.screenLight` is the same light on screen and belongs to the ground, the
 * shade, the sheen and the atmosphere, which are laid down outside it. Reading
 * the wrong one is not a subtle error — it is a frame lit from two directions.
 */

/** Screen lifts on a dark ground; on a light one it does nothing, so multiply. */
function lightenBlend(p: Palette): string {
  return p.mode === 'light' ? 'multiply' : 'screen'
}

export function lightDefs(ctx: RenderContext, uid: string, character: Character): string[] {
  const { u, light, palette: p } = ctx
  /**
   * Every filter region is given in user space over the canvas, never on the
   * bounding box of what it is applied to.
   *
   * A bounding-box region is a percentage of the content's own extent, and the
   * content is sometimes a single vertical hairline crossing the frame, or a
   * pass with nothing in it. That is a region with no width, which one
   * rasteriser we rely on treats as a fatal error rather than as nothing to
   * draw: it was the cause of nearly half the catalogue failing to rasterise in
   * the headless sheet. A fixed region costs nothing measurable in a browser,
   * which clips it to the drawn area regardless.
   */
  const m = u(120)
  const region = {
    filterUnits: 'userSpaceOnUse',
    x: -m, y: -m, width: ctx.w + 2 * m, height: ctx.h + 2 * m,
  }

  /**
   * A shadow is sized by the thing that throws it.
   *
   * This was one drop shadow with three constants in it, and at phone scale
   * they resolved to a 4px offset with a 6px penumbra — under a form whose
   * radius is two hundred to four hundred pixels that is not a shadow, it is a
   * dark rim, and it was the same rim under a small quiet subject and a
   * frame-overrunning atmospheric one. Two layers fix both halves: a tight
   * contact term that says the form touches something, and an ambient one
   * scaled off the form's own radius that says how far above it that something
   * is. The flood is pushed toward black rather than left at `ink`, because on
   * a dark ground `ink` at half alpha is invisible and on a light one it lays
   * flat grey over the picture instead of darkening it.
   */
  const reach = Math.max(ctx.focal.rx, ctx.focal.ry)
  const shadowHex = mixHex(p.ink, '#000000', 0.35)

  /**
   * Shadow-only: the source is never merged back in.
   *
   * `feDropShadow` emits the shadow AND the thing that cast it, so the shadow's
   * strength is tied to the caster's own alpha — and the focal form is now a
   * tint rather than an opaque disc, which would have taken the shadow down
   * with it. Emitting the shadow alone lets the compositor draw it under a
   * translucent form at full strength.
   */
  const shadowLayer = (
    name: string, dist: number, std: number, opacity: number,
  ): string =>
    el('feOffset', {
      in: 'SourceAlpha', dx: -light.dx * dist, dy: -light.dy * dist, result: `${name}o`,
    }) +
    el('feGaussianBlur', { in: `${name}o`, stdDeviation: std, result: `${name}b` }) +
    el('feFlood', { 'flood-color': shadowHex, 'flood-opacity': opacity, result: `${name}f` }) +
    el('feComposite', { in: `${name}f`, in2: `${name}b`, operator: 'in', result: name })

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

    // A second scale of air. One blur radius for every mass in the atmosphere
    // is why it averaged to a single smear: real air has a large scale and a
    // medium one, and the difference between them is what reads as depth.
    el('filter',
      {
        id: `${uid}-soft-tight`,
        filterUnits: 'userSpaceOnUse',
        x: -ctx.w, y: -ctx.h, width: ctx.w * 3, height: ctx.h * 3,
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(28) })),

    /**
     * The accent's halo, and it is a different thing on a light ground.
     *
     * On a dark one it is light in air: blur the source and push its alpha up
     * so the glow reads, and let it sit under the mark, where screen only
     * lifts it further. On a light one a bright mark spreads INTO the ground,
     * so the halo is ink in paper — and it has to be subtracted from the mark's
     * own footprint before it is drawn, because an accent at half alpha (which
     * is most of them) would let a blurred dark copy of itself show straight
     * through and turn the one bright thing in the frame to mud. Saturating
     * the alpha first is what makes `out` remove all of the mark rather than
     * the fraction of it that happens to be opaque.
     */
    el('filter',
      {
        id: `${uid}-bloom`, ...region,
        'color-interpolation-filters': 'sRGB',
      },
      p.mode === 'light'
        ? el('feComponentTransfer', { in: 'SourceAlpha', result: 'a' },
            el('feFuncA', { type: 'linear', slope: 3 })) +
          el('feGaussianBlur', { in: 'a', stdDeviation: u(9 * character.bloom), result: 'b' }) +
          el('feComposite', { in: 'b', in2: 'a', operator: 'out', result: 'ring' }) +
          el('feFlood', { 'flood-color': mixHex(p.ink, p.ground, 0.45), result: 'f' }) +
          el('feComposite', { in: 'f', in2: 'ring', operator: 'in' })
        : el('feGaussianBlur', { stdDeviation: u(9 * character.bloom), result: 'b' }) +
          el('feComponentTransfer', { in: 'b' },
            el('feFuncA', { type: 'linear', slope: 1.9 }))),

    // the subject sits above the field, so it casts
    el('filter',
      {
        id: `${uid}-cast`, ...region,
        'color-interpolation-filters': 'sRGB',
      },
      shadowLayer('am', reach * 0.08, reach * 0.09, 0.18) +
      shadowLayer('ct', u(2), u(3), 0.5) +
      el('feMerge', {},
        el('feMergeNode', { in: 'am' }) + el('feMergeNode', { in: 'ct' }))),

    // A lighter touch for elements that cross in front. Small, dark and barely
    // blurred: this rides on whole groups, so a pass of two hundred hairlines
    // gets two hundred of it, and anything wider came out furry.
    el('filter',
      {
        id: `${uid}-lift`, ...region,
        'color-interpolation-filters': 'sRGB',
      },
      el('feDropShadow', {
        dx: -light.dx * u(2.5),
        dy: -light.dy * u(2.5),
        stdDeviation: u(2),
        'flood-color': shadowHex,
        'flood-opacity': 0.38,
      })),
  ]
}

/**
 * The focal form, modelled.
 *
 * The form used to be one opaque path filled with a mix of the ground and the
 * bottom of the ramp — which, at the fills the directions actually ask for, is
 * the ground colour again. It punched a flat hole through the lit ground, the
 * shade, the atmosphere and everything drawn behind it, and it disagreed with
 * the light by construction because it had no shading on it at all. These are
 * the three things that turn a disc back into a form: a gradient running along
 * the light, a rim on the lit side only, and an occlusion turning the far limb
 * under. Three defs for the whole composition, whatever it costs to draw.
 *
 * The palette's ramp is ordered by contrast against the ground, not by
 * luminance, so `ramp(t)` is only reliably brighter on a dark palette. Light
 * and mid grounds take a white mix instead, or the lit side of the form would
 * come out darker than the shadowed one.
 */
export function formGradients(ctx: RenderContext, uid: string, character: Character): string[] {
  const { palette: p, light, focals } = ctx
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const foc of focals) {
    x0 = Math.min(x0, foc.cx - foc.rx)
    x1 = Math.max(x1, foc.cx + foc.rx)
    y0 = Math.min(y0, foc.cy - foc.ry)
    y1 = Math.max(y1, foc.cy + foc.ry)
  }
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const r = Math.max(x1 - x0, y1 - y0) * 0.62 || ctx.short * 0.3
  const litX = cx + light.dx * r
  const litY = cy + light.dy * r

  // A form the direction barely fills gets barely any modelling, or the
  // shading would be louder than the thing it is shading.
  const k = Math.min(1, 0.35 + 0.7 * character.formFill)
  const deep = p.mode === 'dark'
  const lit = deep ? ctx.ramp(0.3) : mixHex(p.ground, '#FFFFFF', 0.4)
  const rim = deep ? ctx.ramp(0.95) : mixHex(p.ground, '#FFFFFF', 0.75)
  const dark = deep ? mixHex(p.ink, '#000000', 0.2) : mixHex(p.ink, p.ground, 0.35)
  const darkA = (deep ? 0.5 : 0.34) * k

  return [
    el('linearGradient',
      {
        id: `${uid}-form`, gradientUnits: 'userSpaceOnUse',
        x1: litX, y1: litY, x2: cx - light.dx * r, y2: cy - light.dy * r,
      },
      el('stop', { offset: '0', 'stop-color': lit, 'stop-opacity': (0.36 * k).toFixed(3) }) +
      // the terminator: past here the form turns away from the light
      el('stop', { offset: '0.55', 'stop-color': lit, 'stop-opacity': 0 }) +
      el('stop', { offset: '1', 'stop-color': dark, 'stop-opacity': darkA.toFixed(3) })),

    el('linearGradient',
      {
        id: `${uid}-form-rim`, gradientUnits: 'userSpaceOnUse',
        x1: litX, y1: litY, x2: cx - light.dx * r * 0.25, y2: cy - light.dy * r * 0.25,
      },
      el('stop', { offset: '0', 'stop-color': rim, 'stop-opacity': (0.45 * k).toFixed(3) }) +
      el('stop', { offset: '1', 'stop-color': rim, 'stop-opacity': 0 })),

    el('radialGradient',
      {
        id: `${uid}-form-occ`, gradientUnits: 'userSpaceOnUse',
        cx: litX, cy: litY, r: r * 2.1,
      },
      el('stop', { offset: '0.45', 'stop-color': dark, 'stop-opacity': 0 }) +
      el('stop', { offset: '1', 'stop-color': dark, 'stop-opacity': (0.28 * k).toFixed(3) })),
  ]
}

/**
 * Large blurred colour fields behind the artwork.
 *
 * This is the whole difference between a flat ground and one that feels lit.
 * Ellipses, blurred hard, in the palette's own colours: a mesh gradient built
 * out of shapes, which costs a few small filter regions rather than a
 * full-frame pass.
 */
export function atmosphere(
  ctx: RenderContext,
  uid: string,
  plan: LayoutPlan,
  character: Character,
): string {
  if (character.atmosphere <= 0) return ''
  const { w, h, short, palette: p, screenLight: light } = ctx

  // Light comes from somewhere. Three masses, each with a reason to exist: the
  // source, the subject it falls on, and the air between. Five blobs at random
  // positions average out to fog, and fog is the one thing that guarantees a
  // flat picture.
  //
  // Dark palettes take less. They begin near the bottom of the value range,
  // which is their whole appeal, and a lift sized for a light ground spends it.
  // Dark grounds took a much smaller lift when the ramps were monochrome and a
  // glow was just a paler patch of the same hue. Now the top of the ramp is a
  // different colour from the ground, the glow is the point, and it can carry.
  const gain = (p.mode === 'dark' ? 0.8 : 1) * character.atmosphere
  const srcX = w * 0.5 + light.dx * short * 0.85
  const srcY = h * 0.5 + light.dy * short * 0.85

  /**
   * The third mass is pushed off the line.
   *
   * Source, subject and the midpoint of the two are collinear by construction,
   * so three masses averaged to one broad smear along one axis — which is a
   * gradient, not air. Stepping the smallest one out along the perpendicular
   * makes a triangle, and it goes to whichever side keeps it nearer the middle
   * of the frame so it lands in the picture rather than off the edge of it.
   */
  const midX = (srcX + plan.screen.cx) * 0.5
  const midY = (srcY + plan.screen.cy) * 0.5
  const px = -light.dy * short * 0.45
  const py = light.dx * short * 0.45
  const side =
    Math.hypot(midX + px - w * 0.5, midY + py - h * 0.5) <=
    Math.hypot(midX - px - w * 0.5, midY - py - h * 0.5)
      ? 1
      : -1

  type Blob = { cx: number; cy: number; rx: number; ry: number; tone: string; a: number }
  const blob = (b: Blob) =>
    el('path', { d: ellipsePath(b.cx, b.cy, b.rx, b.ry), fill: withAlpha(b.tone, b.a * gain) })

  // The accent is spent exactly once per composition and is meant to be seen.
  // As a frame-sized soft mass it was neither: it muddied the ground with a
  // hue that belonged to nothing, and the one bright mark had nothing left to
  // be. Here it is a tendency in the light instead of a coloured cloud.
  const wide: Blob[] = [
    { cx: srcX, cy: srcY, rx: short * 1.05, ry: short * 0.9, tone: ctx.ramp(0.96), a: 0.34 },
    {
      cx: plan.screen.cx, cy: plan.screen.cy, rx: short * 0.6, ry: short * 0.66,
      tone: mixHex(ctx.ramp(0.85), p.accent, 0.35), a: 0.14,
    },
  ]
  const tight: Blob[] = [
    {
      cx: midX + px * side, cy: midY + py * side,
      rx: short * 0.42, ry: short * 0.34, tone: ctx.ramp(0.6), a: 0.17,
    },
  ]

  const blend = `mix-blend-mode:${lightenBlend(p)}`
  return (
    el('g', { filter: `url(#${uid}-soft)`, style: blend }, wide.map(blob).join('')) +
    el('g', { filter: `url(#${uid}-soft-tight)`, style: blend }, tight.map(blob).join(''))
  )
}

/**
 * The other half of the light model, and the half that was missing.
 *
 * Everything else here blends `screen`. With no counterpart the deep grounds
 * get lifted by every pass that touches them and the frame settles into the
 * middle of its own value range, which is what "bland" is. This is one soft
 * mass in the quadrant the light does not reach, multiplied, so a composition
 * has somewhere genuinely dark to sit against.
 *
 * It is drawn twice, and `scale` is which of the two. Under the field it only
 * ever reached bare ground, so the artwork got lifted by the sheen and
 * deepened by nothing — everything in the middle of the range, which is the
 * same complaint again. The second, weaker pass goes over the field so the
 * multiply half touches the same pixels the screen half does.
 */
export function shade(
  ctx: RenderContext,
  uid: string,
  character: Character,
  scale = 1,
): string {
  if (character.atmosphere <= 0) return ''
  const { w, h, short, palette: p, screenLight: light } = ctx
  const depth = (p.mode === 'light' ? 0.2 : 0.45) * character.atmosphere * scale

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
  const { w, h, short, palette: p, screenLight: light } = ctx
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

/**
 * A ground that is lit rather than filled: the palette's own colours, softened.
 *
 * Unless the direction is printed, in which case it is exactly filled. A
 * gradient is a claim that light is falling across the surface, and under flat
 * shapes with hard edges that claim is the thing that makes the picture look
 * like a render of a poster instead of a poster.
 */
export function groundFill(ctx: RenderContext, uid: string, flat = false): string {
  const { w, h, short, palette: p, screenLight: light } = ctx
  if (flat) {
    return el('rect', { x: 0, y: 0, width: w, height: h, fill: p.ground })
  }

  // A vertical ramp on every style is why forty-three of them read as
  // siblings. Running the axis along the light means the ground says where the
  // light is before anything is drawn on it, and no two angles ground alike.
  // Further up the ramp than before: with hue in the ramp this is the second
  // colour of the ground's own gradient, not a paler version of the first.
  const lit = p.mode === 'light' ? mixHex(p.ground, '#FFFFFF', 0.3) : ctx.ramp(0.38)
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

/**
 * The accent, with its halo underneath it.
 *
 * The halo used to blend `screen` unconditionally, which against a light
 * ground is very nearly a no-op — so on every paper, mist, sand, rose, citron
 * and sherbet composition the accent arrived as a naked chip of saturated
 * colour with nothing around it, a UI badge dropped on the picture. The blend
 * has to follow the ground: a bright mark on paper spreads into it, which is a
 * multiply, and the `-bloom` filter shapes itself to match.
 */
export function bloomed(
  accent: string,
  uid: string,
  character: Character,
  p: Palette,
): string {
  if (character.bloom <= 0) return accent
  const pale = p.mode === 'light'
  return (
    el('g',
      {
        filter: `url(#${uid}-bloom)`,
        opacity: pale ? 0.26 : undefined,
        style: `mix-blend-mode:${lightenBlend(p)}`,
      },
      accent) +
    accent
  )
}

void f
