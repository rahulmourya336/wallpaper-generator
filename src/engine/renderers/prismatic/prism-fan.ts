import { clamp, el, f, lerp } from '../../svg'
import { toward, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A beam through a prism.
 *
 * One white line goes in, a fan comes out, and the whole picture is the
 * geometry of that event: the beam bends once at the entry face and once at
 * the exit, and the fan opens because the two bends do not cancel. Drawing it
 * as one wedge per band rather than as a gradient is deliberate — a spectrum
 * painted as a smooth ramp reads as a gradient, and a spectrum built out of
 * discrete wedges reads as light being separated, which is the thing being
 * depicted.
 *
 * The bands run through the palette rather than through a rainbow. A literal
 * spectrum would be the one image in the studio that ignores the colour it was
 * given, and it would clash with every ground it was drawn on; the ramp is
 * ordered by contrast, so stepping along it separates the bands exactly as
 * legibly and stays inside the composition.
 */

const schema: ParamSchema = [
  { key: 'bands', label: 'Bands', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.55 },
  { key: 'spread', label: 'Fan spread', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.5 },
  { key: 'reach', label: 'Reach', type: 'range', min: 0.3, max: 1, step: 0.01, default: 0.72 },
  { key: 'haze', label: 'Haze', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'facets', label: 'Facet lines', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'diamond', 'lens', 'circle'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, palette, focal } = ctx
  const bandK = ctx.num('bands')
  const spreadK = ctx.num('spread')
  const reachK = ctx.num('reach')
  const hazeK = ctx.num('haze')
  const facetK = ctx.num('facets')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const R = Math.max(focal.rx, focal.ry)
  const reach = Math.hypot(w, h) * lerp(0.55, 1.15, reachK)

  /**
   * The fan is aimed across the frame, not along the light.
   *
   * Sending it downstream of the light source was the tidy answer and the wrong
   * one: the layout puts the glass wherever it likes, so half the time the fan
   * left through the nearest corner and all that survived was a wedge of glow
   * in the margin. Bending light is the one thing a prism is for, so the exit
   * direction is free — aiming it at the middle of the frame costs nothing
   * physically and guarantees the fan crosses the picture.
   *
   * The incoming beam still arrives from the light, so the source is not lost.
   */
  const out = (() => {
    /**
     * Aim at the glass's own mirror point about the frame centre.
     *
     * That is the single bearing guaranteed to have the whole frame in front of
     * it — the ray runs from the glass, through the middle, and out the far
     * side. Aiming at the bearing with the most *room* instead sends the fan
     * diagonally into the nearest corner, which has plenty of room and almost
     * no picture in it.
     */
    const tx = w - 2 * focal.cx
    const ty = h - 2 * focal.cy
    // dead centre has no mirror direction, so fall back to the long axis
    const aim = Math.hypot(tx, ty) > ctx.short * 0.12
      ? Math.atan2(ty, tx)
      : (h > w ? Math.PI / 2 : 0) + (skel.bool() ? Math.PI : 0)
    return aim + skel.range(-0.35, 0.35)
  })()

  /**
   * The apex sits on the exit face, not at the middle of the glass.
   *
   * With the fan springing from the centre, the form the compositor paints for
   * the focal sits squarely on top of the first two thirds of it — the picture
   * became a flat slab with a glow leaking round the edge. Light leaves through
   * a face, so the apex belongs on the boundary, and the whole fan is then
   * outside the shape that was hiding it.
   */
  const apexX = focal.cx + Math.cos(out) * R * 0.82
  const apexY = focal.cy + Math.sin(out) * R * 0.82
  const spread = lerp(0.5, 1.7, spreadK)
  const bands = Math.round(lerp(7, 26, bandK))

  // --- the fan -------------------------------------------------------------
  /**
   * Every band is cut into rings rather than faded with a mask.
   *
   * A mask is the obvious way to make the fan die out with distance and it cost
   * two rounds of guessing to find out it was silently eating the whole fan —
   * mask geometry has its own units, its own default region, and no error when
   * any of that is wrong; the picture simply comes back empty and looks like a
   * colour problem. An annular sector carries its opacity as a number on the
   * element, which is a thing that can be read back and reasoned about.
   *
   * It also happens to be more correct. Light falls off along its path, so
   * cutting the fan into rings lets each band lose intensity *and* step tone as
   * it travels, which a single flat wedge under a mask cannot do.
   */
  const RINGS = 5
  const sector = (a0: number, a1: number, r0: number, r1: number): string =>
    `M${f(apexX + Math.cos(a0) * r0)} ${f(apexY + Math.sin(a0) * r0)}` +
    `L${f(apexX + Math.cos(a0) * r1)} ${f(apexY + Math.sin(a0) * r1)}` +
    `A${f(r1)} ${f(r1)} 0 0 1 ${f(apexX + Math.cos(a1) * r1)} ${f(apexY + Math.sin(a1) * r1)}` +
    `L${f(apexX + Math.cos(a1) * r0)} ${f(apexY + Math.sin(a1) * r0)}` +
    `A${f(r0)} ${f(r0)} 0 0 0 ${f(apexX + Math.cos(a0) * r0)} ${f(apexY + Math.sin(a0) * r0)}Z`

  const wedge: string[] = []
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands
    const t1 = (i + 1) / bands
    // a hair of angular overlap, or the antialiased seams read as dark spokes
    const bleed = (spread / bands) * 0.08
    const a0 = out + (t0 - 0.5) * spread - bleed
    const a1 = out + (t1 - 0.5) * spread + bleed
    // brightest through the middle of the fan, the way a real one is
    const mid = 1 - Math.abs(t0 + t1 - 1)
    const tone = ctx.ramp(0.42 + 0.58 * t0)

    for (let r = 0; r < RINGS; r++) {
      const r0 = R * 0.4 + ((reach - R * 0.4) * r) / RINGS
      const r1 = R * 0.4 + ((reach - R * 0.4) * (r + 1.06)) / RINGS
      const far = r / (RINGS - 1)
      wedge.push(el('path', {
        d: sector(a0, a1, r0, r1),
        fill: tone,
        opacity: ((0.42 + 0.5 * mid) * (1 - far * 0.55)).toFixed(3),
      }))
    }
  }
  front.push(wedge.join(''))

  /**
   * A hard line on every band boundary.
   *
   * Filled wedges alone blur into one another once the ramp steps are small,
   * and a spectrum with no visible divisions is just a gradient — which is the
   * one thing this renderer exists not to be.
   */
  for (let i = 0; i <= bands; i++) {
    const a = out + (i / bands - 0.5) * spread
    const edgeOfFan = i === 0 || i === bands
    front.push(el('path', {
      d:
        `M${f(apexX + Math.cos(a) * R * 0.4)} ${f(apexY + Math.sin(a) * R * 0.4)}` +
        `L${f(apexX + Math.cos(a) * reach * 0.92)} ${f(apexY + Math.sin(a) * reach * 0.92)}`,
      stroke: withAlpha(ctx.ramp(1), edgeOfFan ? 0.6 : 0.32),
      'stroke-width': u(edgeOfFan ? 2 : 0.9),
      fill: 'none',
    }))
  }

  // --- the incoming beam ---------------------------------------------------
  const inA = Math.atan2(ctx.light.dy, ctx.light.dx) + skel.range(-0.3, 0.3)
  const inLen = Math.hypot(w, h)
  const beamW = u(lerp(5, 15, spreadK))
  const bx = apexX + Math.cos(inA) * inLen
  const by = apexY + Math.sin(inA) * inLen
  behind.push(
    el('path', {
      d: `M${f(bx)} ${f(by)}L${f(apexX)} ${f(apexY)}`,
      stroke: withAlpha(ctx.ramp(0.9), 0.22), 'stroke-width': beamW * 2.6,
      'stroke-linecap': 'round', fill: 'none',
    }),
    el('path', {
      d: `M${f(bx)} ${f(by)}L${f(apexX)} ${f(apexY)}`,
      stroke: withAlpha(ctx.ramp(1), 0.8), 'stroke-width': beamW * 0.5,
      'stroke-linecap': 'round', fill: 'none',
    }),
  )

  // --- the glass itself ----------------------------------------------------
  // Facet lines across the form: the internal planes the beam bounced off.
  if (facetK > 0.03) {
    const cuts = Math.round(lerp(3, 14, facetK))
    const inner: string[] = []
    for (let i = 0; i < cuts; i++) {
      const a = skel.range(0, Math.PI)
      const off = skel.range(-0.85, 0.85) * R
      const nx = Math.cos(a)
      const ny = Math.sin(a)
      const cx = focal.cx + -ny * off
      const cy = focal.cy + nx * off
      const half = R * 1.4
      inner.push(el('path', {
        d: `M${f(cx - nx * half)} ${f(cy - ny * half)}L${f(cx + nx * half)} ${f(cy + ny * half)}`,
        stroke: withAlpha(ctx.ramp(skel.range(0.75, 1)), skel.range(0.3, 0.8)),
        'stroke-width': u(skel.range(0.8, 2.6)), fill: 'none',
      }))
    }
    subject.push(inner.join(''))
  }

  // The lit edge of the glass, on the side the beam arrives from.
  subject.push(el('path', {
    d: focal.path, fill: 'none',
    stroke: withAlpha(ctx.ramp(1), 0.9), 'stroke-width': u(3.4),
  }))
  subject.push(el('path', {
    d: focal.path,
    fill: withAlpha(ctx.ramp(0.55), 0.16),
  }))

  // --- haze: the volume the fan is passing through -------------------------
  if (hazeK > 0.03) {
    const motes = Math.round(lerp(40, 260, hazeK) * clamp(ctx.quality, 0.3, 2))
    for (let i = 0; i < motes; i++) {
      const t = ctx.rng.next() ** 0.6
      const a = out + (ctx.rng.next() - 0.5) * spread * 1.1
      const dist = t * reach
      const x = apexX + Math.cos(a) * dist + ctx.rng.range(-1, 1) * u(14)
      const y = apexY + Math.sin(a) * dist + ctx.rng.range(-1, 1) * u(14)
      if (x < -u(20) || x > w + u(20) || y < -u(20) || y > h + u(20)) continue
      back.push(el('circle', {
        cx: x, cy: y, r: u(ctx.rng.range(0.6, 2.6)),
        fill: ctx.ramp(0.8),
        opacity: (0.1 + 0.4 * (1 - t) * hazeK).toFixed(3),
      }))
    }
  }

  // A single band running clear across the frame and off it, so the fan is not
  // politely contained by the picture.
  const runner = out + skel.range(-0.35, 0.35) * spread
  front.push(el('path', {
    d:
      `M${f(apexX)} ${f(apexY)}` +
      `L${f(apexX + Math.cos(runner - 0.012) * reach * 1.6)} ${f(apexY + Math.sin(runner - 0.012) * reach * 1.6)}` +
      `L${f(apexX + Math.cos(runner + 0.012) * reach * 1.6)} ${f(apexY + Math.sin(runner + 0.012) * reach * 1.6)}Z`,
    fill: withAlpha(ctx.ramp(1), 0.65),
  }))

  // --- the accent: the entry point, where the beam meets the glass ---------
  const accent =
    el('circle', { cx: apexX, cy: apexY, r: u(6), fill: palette.accent }) +
    el('circle', {
      cx: apexX, cy: apexY, r: u(17), fill: 'none',
      stroke: withAlpha(palette.accent, 0.45), 'stroke-width': u(1.6),
    }) +
    el('path', {
      d:
        `M${f(apexX)} ${f(apexY)}` +
        `L${f(apexX + Math.cos(out) * R * 2.2)} ${f(apexY + Math.sin(out) * R * 2.2)}`,
      stroke: withAlpha(toward(palette, palette.accent, 0.2), 0.55),
      'stroke-width': u(2.2), 'stroke-linecap': 'round', fill: 'none',
    })

  return { back, behind, subject, front, accent }
}

export const prismFan: Renderer = {
  id: 'prism-fan',
  name: 'Prism Fan',
  family: 'prismatic',
  dark: true,
  focals: ['diamond', 'lens', 'circle'],
  sampler: 'field',
  schema,
  render,
}
