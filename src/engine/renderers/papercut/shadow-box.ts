import { clamp, el, f, lerp, smooth } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A paper shadow box: sheets stacked with a hole cut through each one.
 *
 * Every sheet is the whole frame with its aperture subtracted by the even-odd
 * rule, and they are painted from the deepest forward. Each new sheet covers
 * everything except its own opening, which is larger than the one behind it —
 * so what survives is a tunnel, and the sequence of surviving rims is the only
 * thing drawn. There is no perspective maths anywhere in this file. The depth
 * comes entirely from the rims getting smaller, darker and closer together, and
 * that is genuinely how the real object works.
 *
 * Two details do the rest. Each sheet drops a shadow onto the one behind it,
 * which is what gives the stack thickness rather than reading as flat rings;
 * and the apertures drift toward a common point rather than staying concentric,
 * so the tunnel leans and you can tell you are looking into it at an angle.
 *
 * The one rule that must not be broken is that the aperture outlines never
 * cross. They are one lobed shape function scaled down, exactly as in the agate
 * — nesting by construction, not by luck.
 */

const schema: ParamSchema = [
  { key: 'layers', label: 'Sheets', type: 'range', min: 3, max: 16, step: 1, default: 9 },
  { key: 'taper', label: 'Depth', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.55 },
  { key: 'lobes', label: 'Cut shape', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'lean', label: 'Lean', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'lift', label: 'Sheet shadow', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'arch', 'portal', 'circle', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, palette, focal } = ctx
  const count = clamp(Math.round(ctx.num('layers')), 3, 16)
  const taperK = ctx.num('taper')
  const lobeK = ctx.num('lobes')
  const leanK = ctx.num('lean')
  const liftK = ctx.num('lift')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const drop = u(lerp(2, 10, liftK))
  const dx = drop * ctx.light.dx
  const dy = -drop * ctx.light.dy

  // The mouth of the tunnel, and the point everything shrinks toward.
  const R = Math.max(Math.max(focal.rx, focal.ry) * 1.15, ctx.short * lerp(0.52, 0.78, taperK))
  const squash = clamp(focal.ry / Math.max(focal.rx, 1), 0.6, 1.7)
  const vanishX = focal.cx + skel.range(-1, 1) * R * 0.55 * leanK
  const vanishY = focal.cy + skel.range(-1, 1) * R * 0.55 * leanK

  // one shape function, shared by every aperture, so they cannot cross
  const p1 = skel.range(0, Math.PI * 2)
  const p2 = skel.range(0, Math.PI * 2)
  const n1 = skel.int(2, 3)
  const n2 = skel.int(4, 6)
  const a1 = lobeK * skel.range(0.08, 0.26)
  const a2 = lobeK * skel.range(0.03, 0.12)
  const shape = (a: number) => 1 + a1 * Math.sin(a * n1 + p1) + a2 * Math.sin(a * n2 + p2)

  const aperture = (k: number, cx: number, cy: number): string => {
    const steps = 40
    const pts: number[] = []
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const r = R * k * shape(a)
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r * squash)
    }
    pts.push(pts[0] as number, pts[1] as number, pts[2] as number, pts[3] as number)
    return `${smooth(pts, 0.5)}Z`
  }

  /**
   * Painted deepest first.
   *
   * i = 0 is the sheet furthest in, with the smallest hole; each later sheet is
   * nearer, lighter and has a bigger hole, and covers everything except what
   * shows through it. Reversing this order paints the near sheets first and the
   * far ones on top of them, which produces a set of flat concentric rings —
   * the same geometry, and none of the depth.
   */
  const stack: string[] = []
  const bed = mixHex(palette.ink, ctx.ramp(0.2), 0.35)

  // the floor of the box, seen through every opening
  stack.push(el('rect', { x: -u(20), y: -u(20), width: w + u(40), height: h + u(40), fill: bed }))

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    // holes open up toward the viewer; the power curve crowds the far rims
    const k = lerp(0.16, 1, t ** lerp(1.5, 0.7, taperK))
    const cx = lerp(vanishX, w / 2, t)
    const cy = lerp(vanishY, h / 2, t)
    const hole = aperture(k, cx, cy)
    const tone = ctx.ramp(clamp(0.95 - 0.92 * t, 0, 1))

    // the sheet: the whole frame, minus its own opening
    stack.push(el('path', {
      d: `M${f(-u(20))} ${f(-u(20))}H${f(w + u(20))}V${f(h + u(20))}H${f(-u(20))}Z${hole}`,
      'fill-rule': 'evenodd',
      fill: tone,
    }))

    // what this sheet throws onto the one behind it, inside the opening
    if (liftK > 0.03) {
      stack.push(el('path', {
        d: hole, fill: 'none',
        stroke: withAlpha(palette.ink, 0.24 + 0.3 * liftK),
        'stroke-width': drop * 3.2,
        transform: `translate(${f(dx)} ${f(dy)})`,
      }))
    }

    // the cut edge, one hairline on the lit side
    stack.push(el('path', {
      d: hole, fill: 'none',
      stroke: withAlpha(ctx.ramp(0.03), 0.4),
      'stroke-width': u(1.2),
      transform: `translate(${f(-dx * 0.3)} ${f(-dy * 0.3)})`,
    }))
  }

  behind.push(stack.join(''))
  subject.push(el('g', { opacity: 0.9 }, stack.join('')))

  /**
   * The frame is not the picture.
   *
   * Painted into `back`, the stack would be clipped to everything outside the
   * focal form and the composition would be a rectangle of flat paper with the
   * subject cut out of it. A tunnel has to be seen through the form, so the
   * outside gets only the outermost sheet — the plain surface the box is
   * mounted on.
   */
  back.push(el('rect', {
    x: -u(20), y: -u(20), width: w + u(40), height: h + u(40),
    fill: ctx.ramp(0.1),
  }))

  // --- deckle: a torn edge on one sheet, so the stack reads as handmade ----
  const torn: number[] = []
  const tornY = h * skel.range(0.12, 0.86)
  for (let i = 0; i <= 30; i++) {
    const t = i / 30
    torn.push(
      -u(20) + t * (w + u(40)),
      tornY + Math.sin(t * 9 + skel.range(0, 5)) * ctx.short * 0.03 + skel.range(-1, 1) * u(5),
    )
  }
  front.push(
    el('path', {
      d: smooth(torn, 0.5), fill: 'none',
      stroke: withAlpha(palette.ink, 0.18), 'stroke-width': u(4),
      transform: `translate(${f(dx)} ${f(dy)})`,
    }),
    el('path', {
      d: smooth(torn, 0.5), fill: 'none',
      stroke: withAlpha(ctx.ramp(0.03), 0.5), 'stroke-width': u(1.5),
    }),
  )

  // --- the accent: what is lit at the bottom of the box -------------------
  const deep = aperture(0.14, vanishX, vanishY)
  const accent =
    el('path', { d: aperture(0.3, vanishX, vanishY), fill: withAlpha(palette.accent, 0.2) }) +
    el('path', { d: deep, fill: palette.accent }) +
    el('path', {
      d: aperture(0.22, vanishX, vanishY), fill: 'none',
      stroke: withAlpha(palette.accent, 0.55), 'stroke-width': u(1.6),
    })

  return { back, behind, subject, front, accent }
}

export const shadowBox: Renderer = {
  id: 'shadow-box',
  name: 'Shadow Box',
  family: 'papercut',
  dark: false,
  focals: ['arch', 'portal', 'circle', 'ellipse'],
  sampler: 'field',
  schema,
  render,
}
