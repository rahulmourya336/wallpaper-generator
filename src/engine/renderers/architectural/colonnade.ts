import { clamp, el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * An arcade receding to a vanishing point.
 *
 * This is the only renderer in the studio with real perspective, and that is
 * the point of it: every other family builds depth out of overlap and scale,
 * which reads as flat layers stacked up. A single vanishing point makes the
 * frame a place you could walk into.
 *
 * The construction is the draughtsman's one. Bays are spaced along the floor
 * by the diagonal method rather than by even division, because even division
 * in screen space is even division on a wall, not on a floor going away from
 * you: spacing has to compress geometrically or the corridor comes out as a
 * fan. Each bay is then a pier and an arch built between two floor points, and
 * the light throws one shadow per pier across the floor, all agreeing on the
 * same source.
 */

const schema: ParamSchema = [
  { key: 'bays', label: 'Bays', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'depth', label: 'Depth', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.6 },
  { key: 'rise', label: 'Arch rise', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'shadow', label: 'Shadow length', type: 'range', min: 0, max: 1, step: 0.01, default: 0.65 },
  { key: 'mass', label: 'Pier width', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.45 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'arch', 'portal', 'lens'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette, light, baseline, uid } = ctx
  const bayK = ctx.num('bays')
  const depthK = ctx.num('depth')
  const riseK = ctx.num('rise')
  const shadowK = ctx.num('shadow')
  const massK = ctx.num('mass')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  // The vanishing point sits on the horizon, offset from the subject so the
  // corridor runs past the focal form rather than straight through it.
  // Height comes off the canvas, with the focal only able to raise it. Keyed
  // to focal.ry alone, a layout that hands over a small form collapses the
  // horizon onto the baseline and the whole arcade is squeezed into a band a
  // few pixels tall.
  const horizon = baseline - Math.max(h * 0.24, focal.ry * lerp(0.3, 0.95, depthK))
  const vx = focal.cx + skel.gauss() * w * 0.16
  const vy = horizon

  // The near edge of the colonnade: where the first pier meets the floor.
  //
  // Which side it runs to is not a free choice. A layout that has pushed the
  // subject to an edge leaves room on one side only, and a coin flip sends the
  // whole arcade off the canvas exactly half of those times — which is what an
  // empty frame with one lit corner turns out to be. So the coin only decides
  // it when the vanishing point is near the middle and both sides are open.
  const coin = skel.bool() ? 1 : -1
  const side = vx < w * 0.35 ? 1 : vx > w * 0.65 ? -1 : coin
  const near = clamp(vx + side * w * lerp(0.42, 0.78, depthK), -w * 0.05, w * 1.05)
  const nearTop = vy - h * lerp(0.42, 0.85, riseK)

  const bays = Math.round(lerp(4, 13, bayK))
  const pierW = Math.abs(near - vx) * lerp(0.06, 0.17, massK)

  // Floor positions by geometric compression, so the recession is uniform in
  // the depth direction rather than uniform on screen. The rate stays high:
  // compress harder and every bay after the second piles onto the vanishing
  // point, leaving most of the frame empty.
  const rate = lerp(0.74, 0.89, depthK)
  const xs: number[] = []
  let x = near
  for (let i = 0; i <= bays; i++) {
    xs.push(x)
    x = vx + (x - vx) * rate
  }

  // --- stone shading -------------------------------------------------------
  // Two faces per pier: the one turned to the light and the one turned away.
  // Both are gradients so the stone falls off toward the floor.
  const litTop = ctx.ramp(0.88)
  const litBot = ctx.ramp(0.5)
  const shadeTop = mixHex(ctx.ramp(0.4), palette.ink, 0.28)
  const shadeBot = mixHex(ctx.ramp(0.2), palette.ink, 0.45)
  defs.push(
    el('linearGradient',
      { id: `${uid}-lit`, gradientUnits: 'objectBoundingBox', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
      el('stop', { offset: '0%', 'stop-color': litTop }) +
      el('stop', { offset: '100%', 'stop-color': litBot })),
    el('linearGradient',
      { id: `${uid}-shade`, gradientUnits: 'objectBoundingBox', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
      el('stop', { offset: '0%', 'stop-color': shadeTop }) +
      el('stop', { offset: '100%', 'stop-color': shadeBot })),
    // the corridor mouth: light pouring in from the far end
    el('radialGradient',
      { id: `${uid}-mouth`, gradientUnits: 'userSpaceOnUse', cx: vx, cy: vy, r: Math.abs(near - vx) * 0.5 },
      el('stop', { offset: '0%', 'stop-color': withAlpha(ctx.ramp(1), 0.85) }) +
      el('stop', { offset: '55%', 'stop-color': withAlpha(ctx.ramp(0.75), 0.3) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(ctx.ramp(0.6), 0) })),
  )

  // the far end of the arcade, glowing
  back.push(el('circle', {
    cx: vx, cy: vy, r: Math.abs(near - vx) * 0.5, fill: `url(#${uid}-mouth)`,
  }))

  // the floor plane
  back.push(el('path', {
    d: `M${f(vx - w * 2)} ${f(vy)}H${f(vx + w * 2)}V${f(h + ctx.short)}H${f(vx - w * 2)}Z`,
    fill: withAlpha(mixHex(palette.ground, ctx.ramp(0.35), 0.4), 0.75),
  }))

  // the vault line running back along the top of the arcade
  behind.push(el('path', {
    d: `M${f(near)} ${f(nearTop)}L${f(vx)} ${f(vy)}`,
    fill: 'none', stroke: withAlpha(ctx.ramp(0.55), 0.5), 'stroke-width': u(2),
  }))

  let accent: string | undefined
  let accentDepth = Infinity

  // --- the bays, far to near so nearer stone occludes -----------------------
  for (let i = bays - 1; i >= 0; i--) {
    if (ctx.expired()) break
    const x0 = xs[i] as number
    const x1 = xs[i + 1] as number
    const t = i / bays

    // Everything about a bay follows from its two floor points: the pier top
    // is on the line from the near top to the vanishing point.
    const topAt = (px: number) => vy + ((nearTop - vy) * (px - vx)) / (near - vx)
    const baseAt = (px: number) => vy + ((baseline - vy) * (px - vx)) / (near - vx)

    const pw = pierW * Math.abs((x0 - vx) / (near - vx))
    const inner = x0 - side * pw
    const yTopOuter = topAt(x0)
    const yTopInner = topAt(inner)
    const yBaseOuter = baseAt(x0)
    const yBaseInner = baseAt(inner)

    // pier: the outer face catches the light, the return face is in shadow
    const litFace = (side > 0) === (light.dx > 0)
    const pier = el('path', {
      d: `M${f(x0)} ${f(yTopOuter)}L${f(inner)} ${f(yTopInner)}` +
        `L${f(inner)} ${f(yBaseInner)}L${f(x0)} ${f(yBaseOuter)}Z`,
      fill: `url(#${uid}-${litFace ? 'lit' : 'shade'})`,
    })
    subject.push(pier)
    // Also unclipped, dimmer. The arcade runs across the whole frame and only
    // part of it falls inside the focal form; drawn into `subject` alone the
    // bays outside simply vanish and the composition arrives as an empty
    // panel with a few piers in one corner of it.
    behind.push(el('g', { opacity: 0.62 }, pier))

    // The arch spanning to the next pier. Its springing is the pier top and
    // its crown rises by a fraction of the span, so arches shrink correctly.
    const span = Math.abs(x1 - x0)
    const crown = span * lerp(0.28, 0.62, riseK)
    const yTopNext = topAt(x1)
    const arch = el('path', {
      d: `M${f(inner)} ${f(yTopInner)}` +
        `Q${f((inner + x1) / 2)} ${f(Math.min(yTopInner, yTopNext) - crown)} ${f(x1)} ${f(yTopNext)}`,
      fill: 'none',
      stroke: ctx.ramp(lerp(0.85, 0.45, t)),
      'stroke-width': Math.max(u(1.2), pw * 0.42),
      'stroke-linecap': 'butt',
    })
    subject.push(arch)
    behind.push(el('g', { opacity: 0.62 }, arch))

    // Cast shadow: the pier's own footprint thrown across the floor, away from
    // the light. One direction for the whole composition.
    const throwLen = pw * lerp(1.5, 7, shadowK)
    const sx = -light.dx * throwLen
    const sy = light.dy * throwLen * 0.35
    behind.push(el('path', {
      d: `M${f(x0)} ${f(yBaseOuter)}L${f(inner)} ${f(yBaseInner)}` +
        `L${f(inner + sx)} ${f(yBaseInner + sy)}L${f(x0 + sx)} ${f(yBaseOuter + sy)}Z`,
      fill: withAlpha(palette.ink, (0.14 + 0.3 * shadowK) * (0.35 + 0.65 * (1 - t))),
    }))

    // a light bar between piers, where the sun comes through the opening
    if (i % 2 === 0) {
      behind.push(el('path', {
        d: `M${f(inner)} ${f(yBaseInner)}L${f(x1)} ${f(baseAt(x1))}` +
          `L${f(x1 + sx * 1.6)} ${f(baseAt(x1) + sy * 1.6)}L${f(inner + sx * 1.6)} ${f(yBaseInner + sy * 1.6)}Z`,
        fill: withAlpha(ctx.ramp(0.9), 0.16 * (1 - t * 0.6)),
      }))
    }

    // base moulding, the one horizontal that makes the stone sit
    subject.push(el('path', {
      d: `M${f(x0)} ${f(yBaseOuter)}L${f(inner)} ${f(yBaseInner)}`,
      fill: 'none', stroke: withAlpha(palette.ink, 0.4), 'stroke-width': Math.max(u(1), pw * 0.14),
    }))

    const depth = Math.abs(x0 - vx)
    if (i === Math.floor(bays * 0.45) && depth < accentDepth) {
      accentDepth = depth
      accent =
        el('path', {
          d: `M${f(inner)} ${f(yTopInner)}` +
            `Q${f((inner + x1) / 2)} ${f(Math.min(yTopInner, yTopNext) - crown)} ${f(x1)} ${f(yTopNext)}`,
          fill: 'none', stroke: palette.accent, 'stroke-width': Math.max(u(2), pw * 0.2),
        }) +
        el('path', {
          d: `M${f(inner)} ${f(yBaseInner)}L${f(inner + sx * 0.7)} ${f(yBaseInner + sy * 0.7)}`,
          fill: 'none', stroke: withAlpha(palette.accent, 0.6), 'stroke-width': u(3),
          'stroke-linecap': 'round',
        })
    }
  }

  // The near pier, cropped by the frame, so the viewer is standing inside the
  // arcade rather than looking at a model of one. Its width is capped: left to
  // follow the perspective it grows to swallow the frame.
  const npw = Math.min(pierW * 1.15, w * 0.13)
  front.push(el('path', {
    d: `M${f(near + side * npw)} ${f(nearTop - h * 0.2)}L${f(near)} ${f(nearTop)}` +
      `L${f(near)} ${f(baseline)}L${f(near + side * npw)} ${f(baseline + h * 0.2)}Z`,
    fill: `url(#${uid}-shade)`,
    opacity: 0.92,
  }))

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const colonnade: Renderer = {
  id: 'colonnade',
  name: 'Colonnade',
  family: 'architectural',
  dark: false,
  focals: ['arch', 'portal', 'lens'],
  sampler: 'field',
  schema,
  render,
}
