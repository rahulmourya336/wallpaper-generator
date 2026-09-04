import { clamp, el, f, lerp, smooth } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Shapes cut out with scissors and arranged on a ground.
 *
 * The forms are made in polar coordinates as a radius with lobes on it, which
 * is the cheapest way to get something that is clearly organic and clearly not
 * traced from anything: a few sine terms at whole-number frequencies give a
 * leaf, a starfish or an amoeba depending only on how many lobes and how deep.
 * Smoothing the outline is what makes it read as cut rather than as plotted —
 * scissors cannot turn a corner, so the boundary has curvature everywhere.
 *
 * Only two things then have to be right. Every shape is one flat colour, with
 * no gradient, no stroke and no texture, because the moment a cut-out is shaded
 * it stops being paper. And every shape carries the same offset shadow at the
 * same distance, because they are all lying on the same ground — varying the
 * drop by shape is the single quickest way to destroy the illusion.
 */

const schema: ParamSchema = [
  { key: 'count', label: 'Shapes', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'size', label: 'Scale', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'lobes', label: 'Lobes', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'lift', label: 'Lift', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'variety', label: 'Variety', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'diamond', 'arch'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, palette, focal } = ctx
  const countK = ctx.num('count')
  const sizeK = ctx.num('size')
  const lobeK = ctx.num('lobes')
  const liftK = ctx.num('lift')
  const varietyK = ctx.num('variety')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const drop = u(lerp(4, 20, liftK))
  const dx = drop * ctx.light.dx
  const dy = -drop * ctx.light.dy
  const shade = withAlpha(mixHex(palette.ink, palette.ground, 0.3), 0.16 + 0.2 * liftK)

  /** A closed lobed form, smoothed so no corner survives. */
  const cut = (cx: number, cy: number, r: number, stretch: number, turn: number): string => {
    const lobes = 2 + Math.floor(skel.next() * (1 + lobeK * 6))
    const depth = lobeK * skel.range(0.12, 0.46)
    const skew = skel.range(-0.35, 0.35)
    const steps = 34
    const pts: number[] = []
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const rr = r * (1 + depth * Math.sin(a * lobes + skew * 3) + 0.08 * Math.sin(a * 3 + skew))
      const px = Math.cos(a) * rr
      const py = Math.sin(a) * rr * stretch
      pts.push(
        cx + px * Math.cos(turn) - py * Math.sin(turn),
        cy + px * Math.sin(turn) + py * Math.cos(turn),
      )
    }
    // close the loop through the first two points so the seam is curved too
    pts.push(pts[0] as number, pts[1] as number, pts[2] as number, pts[3] as number)
    return `${smooth(pts, 0.5)}Z`
  }

  // --- the arrangement -----------------------------------------------------
  /**
   * Placed on a loose ring around the subject rather than scattered.
   *
   * Uniform random placement leaves clumps and holes, and a collage with a hole
   * in it looks unfinished rather than composed. A ring with jitter keeps the
   * middle open for the focal form and still never repeats.
   */
  const total = Math.round(lerp(14, 44, countK))
  const base = ctx.short * lerp(0.09, 0.26, sizeK)

  for (let i = 0; i < total; i++) {
    if (ctx.expired()) break
    const t = i / total
    const a = t * Math.PI * 2 + skel.range(-0.5, 0.5)
    const dist = ctx.short * skel.range(0.05, 0.72)
    const cx = focal.cx + Math.cos(a) * dist
    const cy = focal.cy + Math.sin(a) * dist * skel.range(0.8, 1.25)
    if (cx < -base * 2 || cx > w + base * 2 || cy < -base * 2 || cy > h + base * 2) continue

    const near = ctx.falloff(cx, cy)
    const r = base * (skel.next() ** 2.1 * 1.85 + 0.18) * (0.75 + 0.5 * near)
    const stretch = skel.range(0.42, 1) ** (1 + varietyK)
    const turn = skel.range(0, Math.PI * 2)
    // stepped, not continuous: a collage is made from a handful of papers
    const step = Math.floor(skel.next() * 5) / 4
    const tone = ctx.ramp(0.08 + 0.92 * step)

    const d = cut(cx, cy, r, stretch, turn)
    /**
     * The cut edge is not decoration on a mid-ground palette, it is the only
     * thing separating one piece from the next. Those palettes run a single hue
     * from top to bottom of the ramp, so two papers a stop apart are nearly the
     * same brown and the whole collage merges into one shapeless mass. A
     * hairline picked from the far end of the ramp restores the boundary that
     * scissors would have left.
     */
    const piece =
      el('path', { d, fill: shade, transform: `translate(${f(dx)} ${f(dy)})` }) +
      el('path', { d, fill: tone }) +
      el('path', {
        d, fill: 'none',
        stroke: withAlpha(step > 0.5 ? palette.ground : ctx.ramp(1), 0.32),
        'stroke-width': u(1.5),
      })

    subject.push(piece)
    if (skel.bool(0.7)) back.push(piece)
    else behind.push(piece)

    // A few pieces carry a hole punched through them, which is the other thing
    // scissors do and the only place the ground shows through a shape.
    if (skel.bool(0.22 * (0.4 + varietyK))) {
      const hole = cut(cx + skel.range(-0.3, 0.3) * r, cy + skel.range(-0.3, 0.3) * r, r * 0.34, 1, turn)
      const punched =
        el('path', { d: hole, fill: shade, transform: `translate(${f(dx * 0.5)} ${f(dy * 0.5)})` }) +
        el('path', { d: hole, fill: palette.ground })
      subject.push(punched)
      back.push(punched)
    }
  }

  // --- a few strict shapes, for the eye to rest on -------------------------
  const bars = skel.int(1, 4)
  for (let i = 0; i < bars; i++) {
    const bx = skel.range(-0.1, 1) * w
    const by = skel.range(-0.1, 1) * h
    const bw = ctx.short * skel.range(0.05, 0.16)
    const bh = ctx.short * skel.range(0.2, 0.9)
    const turn = skel.range(-0.4, 0.4)
    const d =
      `M${f(bx)} ${f(by)}h${f(bw)}v${f(bh)}h${f(-bw)}Z`
    const g = (extra: Record<string, string | number>) =>
      el('path', { d, transform: `rotate(${f((turn * 180) / Math.PI)} ${f(bx)} ${f(by)})`, ...extra })
    const bar =
      g({ fill: shade, transform: `rotate(${f((turn * 180) / Math.PI)} ${f(bx)} ${f(by)}) translate(${f(dx)} ${f(dy)})` }) +
      g({ fill: ctx.ramp(skel.range(0.3, 0.95)) })
    back.push(bar)
    subject.push(bar)
  }

  // One big piece laid over everything, crossing the form and leaving the frame.
  const oa = skel.range(0, Math.PI * 2)
  const ox = focal.cx + Math.cos(oa) * ctx.short * 0.5
  const oy = focal.cy + Math.sin(oa) * ctx.short * 0.5
  const overD = cut(ox, oy, base * 2.1, skel.range(0.35, 0.7), oa)
  front.push(
    el('path', { d: overD, fill: shade, transform: `translate(${f(dx * 1.6)} ${f(dy * 1.6)})` }),
    el('path', { d: overD, fill: ctx.ramp(skel.range(0.5, 1)) }),
  )

  // --- the accent: one piece cut from the loud paper -----------------------
  const aa = skel.range(0, Math.PI * 2)
  const ax = focal.cx + Math.cos(aa) * focal.rx * 0.55
  const ay = focal.cy + Math.sin(aa) * focal.ry * 0.55
  const accD = cut(ax, ay, base * clamp(0.7 + 0.5 * sizeK, 0.4, 1.6), skel.range(0.5, 1), aa)
  const accent =
    el('path', { d: accD, fill: shade, transform: `translate(${f(dx)} ${f(dy)})` }) +
    el('path', { d: accD, fill: palette.accent })

  return { back, behind, subject, front, accent }
}

export const cutCollage: Renderer = {
  id: 'cut-collage',
  name: 'Cut Collage',
  family: 'papercut',
  dark: false,
  focals: ['circle', 'ellipse', 'diamond', 'arch'],
  sampler: 'field',
  schema,
  render,
}
