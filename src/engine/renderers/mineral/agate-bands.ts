import { clamp, el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A slice of agate.
 *
 * Bands are grown inward from a rind, and the reason they can never cross is
 * structural rather than careful: the outline is one fixed shape function of
 * angle, and each band is that same shape multiplied by a shrinking radius. Two
 * curves that differ only by a positive scale factor are nested by
 * construction. Perturbing each band independently — the obvious way to make
 * them look natural — is what produces the tangles and self-intersections that
 * make generated agate look like spilled paint.
 *
 * Bands are filled solid and painted outside-in, so each one covers the middle
 * of the one before it and only its rim survives. That is both cheaper than
 * building annuli and closer to what happened: the stone really was deposited
 * in layers on top of each other.
 *
 * The last thing is the band widths. Even spacing reads as a target, and real
 * agate alternates thick dull layers with sudden thin bright ones, because
 * deposition rate varied with whatever the water was doing. The bright thin
 * bands are perhaps four per cent of the stone and most of what you look at.
 */

const schema: ParamSchema = [
  { key: 'bands', label: 'Bands', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'wobble', label: 'Irregularity', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'contrast', label: 'Contrast', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.6 },
  { key: 'core', label: 'Crystal core', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'rind', label: 'Rind', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'lens', 'disc'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, palette, focal } = ctx
  const bandK = ctx.num('bands')
  const wobbleK = ctx.num('wobble')
  const contrastK = ctx.num('contrast')
  const coreK = ctx.num('core')
  const rindK = ctx.num('rind')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const cx = focal.cx
  const cy = focal.cy
  const R = Math.max(focal.rx, focal.ry) * lerp(1.25, 2.1, rindK)
  const squash = focal.ry / Math.max(focal.rx, 1)

  /**
   * The outline: one fixed function of angle, shared by every band.
   *
   * Three harmonics is the sweet spot. One is an egg, two is a peanut, and past
   * four the lobes get finer than the band spacing and the stone reads as
   * noise instead of as a shape with layers in it.
   */
  const h1 = skel.range(0, Math.PI * 2)
  const h2 = skel.range(0, Math.PI * 2)
  const h3 = skel.range(0, Math.PI * 2)
  const a1 = wobbleK * skel.range(0.06, 0.2)
  const a2 = wobbleK * skel.range(0.04, 0.14)
  const a3 = wobbleK * skel.range(0.02, 0.08)
  const shape = (a: number): number =>
    1 + a1 * Math.sin(a * 2 + h1) + a2 * Math.sin(a * 3 + h2) + a3 * Math.sin(a * 5 + h3)

  const ring = (k: number): string => {
    const steps = 72
    let d = ''
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const r = R * k * shape(a)
      d += `${i === 0 ? 'M' : 'L'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r * squash)}`
    }
    return `${d}Z`
  }

  // --- the band stack ------------------------------------------------------
  const count = Math.round(lerp(30, 110, bandK))
  const layers: string[] = []

  // The rind: rough, dull, and the only part of the stone that was ever outside.
  if (rindK > 0.03) {
    layers.push(
      el('path', { d: ring(1.06), fill: mixHex(ctx.ramp(0.15), palette.ink, 0.45) }),
      el('path', {
        d: ring(1.0), fill: 'none',
        stroke: withAlpha(ctx.ramp(0.5), 0.5), 'stroke-width': u(2.2),
      }),
    )
  }

  let k = 1
  for (let i = 0; i < count && k > 0.06; i++) {
    // thick dull layers, punctuated by sudden thin bright ones
    const bright = skel.next() < 0.3
    const step = bright
      ? skel.range(0.0035, 0.011)
      : skel.range(0.008, 0.038) * lerp(1.5, 0.6, bandK)
    k -= step
    if (k <= 0.04) break

    const t = 1 - k
    const tone = bright
      ? ctx.ramp(clamp(0.75 + 0.25 * contrastK, 0, 1))
      : ctx.ramp(clamp(0.1 + contrastK * (0.25 + 0.6 * Math.abs(Math.sin(i * 1.7 + t * 4))), 0, 1))

    layers.push(el('path', {
      d: ring(k),
      fill: tone,
      opacity: bright ? 1 : (0.86 + 0.14 * ctx.falloff(cx, cy)).toFixed(3),
    }))
  }

  // --- the crystal core ----------------------------------------------------
  /**
   * The cavity at the middle, lined with quartz.
   *
   * Drawn as wedges radiating from the centre rather than as a texture: quartz
   * grows inward from the cavity wall as prisms all pointing at the same empty
   * space, so the geometry really is radial, and each face catches the one
   * light at a different angle. Alternating the tone by wedge is enough to read
   * as faceted.
   */
  if (coreK > 0.02 && k > 0.05) {
    const coreR = R * k * lerp(0.4, 1, coreK)
    layers.push(el('path', { d: ring(k * 0.98), fill: mixHex(palette.ink, ctx.ramp(0.2), 0.4) }))
    const spikes = Math.round(lerp(9, 30, coreK))
    for (let i = 0; i < spikes; i++) {
      const a0 = (i / spikes) * Math.PI * 2
      const a1 = ((i + 1) / spikes) * Math.PI * 2
      const tip = coreR * skel.range(0.25, 0.95)
      // how square-on this facet is to the light
      const facing = 0.5 + 0.5 * Math.cos((a0 + a1) / 2 - ctx.light.angle)
      layers.push(el('path', {
        d:
          `M${f(cx + Math.cos(a0) * coreR)} ${f(cy + Math.sin(a0) * coreR * squash)}` +
          `L${f(cx + Math.cos(a1) * coreR)} ${f(cy + Math.sin(a1) * coreR * squash)}` +
          `L${f(cx + Math.cos((a0 + a1) / 2) * tip * 0.2)} ${f(cy + Math.sin((a0 + a1) / 2) * tip * 0.2)}Z`,
        fill: ctx.ramp(0.25 + 0.7 * facing),
        opacity: (0.55 + 0.4 * facing).toFixed(3),
      }))
    }
  }

  const stone = layers.join('')
  subject.push(stone)
  behind.push(stone)
  // a second, larger slice ghosted behind, so the frame is a tray of specimens
  back.push(el('g', {
    opacity: 0.28,
    transform:
      `translate(${f(cx)} ${f(cy)}) rotate(${f(skel.range(-40, 40))}) scale(${f(skel.range(1.6, 2.6))}) translate(${f(-cx)} ${f(-cy)})`,
  }, stone))

  // A fracture running clear across the stone and off the frame. Every real
  // slice has one, and it is the only straight line in the picture.
  const fa = skel.range(0, Math.PI * 2)
  const len = ctx.short * 1.6
  front.push(
    el('path', {
      d:
        `M${f(cx - Math.cos(fa) * len)} ${f(cy - Math.sin(fa) * len)}` +
        `L${f(cx + Math.cos(fa) * len)} ${f(cy + Math.sin(fa) * len)}`,
      stroke: withAlpha(palette.ink, 0.5), 'stroke-width': u(3.4), fill: 'none',
    }),
    el('path', {
      d:
        `M${f(cx - Math.cos(fa) * len + u(2))} ${f(cy - Math.sin(fa) * len)}` +
        `L${f(cx + Math.cos(fa) * len + u(2))} ${f(cy + Math.sin(fa) * len)}`,
      stroke: withAlpha(ctx.ramp(1), 0.3), 'stroke-width': u(1.1), fill: 'none',
    }),
  )

  // --- the accent: the one band that took the colour ----------------------
  const ak = clamp(skel.range(0.25, 0.8), 0.1, 0.95)
  const accent =
    el('path', {
      d: ring(ak), fill: 'none', stroke: palette.accent,
      'stroke-width': u(lerp(4, 11, bandK)),
    }) +
    el('path', {
      d: ring(ak * 0.965), fill: 'none',
      stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(2),
    })

  return { back, behind, subject, front, accent }
}

export const agateBands: Renderer = {
  id: 'agate-bands',
  name: 'Agate Bands',
  family: 'mineral',
  dark: true,
  focals: ['circle', 'ellipse', 'lens', 'disc'],
  sampler: 'field',
  schema,
  render,
}
