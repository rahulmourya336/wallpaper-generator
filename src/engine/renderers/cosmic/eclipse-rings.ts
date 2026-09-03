import { circlePath, el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A planet disc with a ring system. The rings are the reason this family
 * exists: half of each ellipse passes behind the disc and half crosses in
 * front of it, and that single occlusion does more for the sense of depth
 * than any amount of shading.
 *
 * The accent is the terminator — the lit crescent along the limb.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Ring count', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'tilt', label: 'Ring tilt', type: 'range', min: 0.04, max: 0.6, step: 0.01, default: 0.22 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'stars', label: 'Stars', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'spread', label: 'Ring spread', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'disc', 'circle'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const starRng = ctx.fork('stars')
  const { w, h, u, focal, palette, light } = ctx
  const densityK = ctx.num('density')
  const tilt = ctx.num('tilt')
  const starsK = ctx.num('stars')
  const spread = ctx.num('spread')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const R = Math.max(focal.rx, focal.ry)
  const cx = focal.cx
  const cy = focal.cy
  const rot = skel.range(-22, 22)

  // stars first, so the rings and the disc read as being in front of them
  if (starsK > 0.02) {
    const count = Math.round(lerp(160, 620, starsK) * Math.max(0.3, ctx.quality ** 0.6))
    for (let i = 0; i < count; i++) {
      const x = starRng.range(-u(20), w + u(20))
      const y = starRng.range(-u(20), h + u(20))
      const mag = starRng.next() ** 3.2
      const fall = ctx.falloff(x, y)
      back.push(el('circle', {
        cx: x, cy: y, r: u(0.7 + 5 * mag) * (0.5 + 0.6 * fall),
        fill: ctx.ramp(0.5 + 0.5 * mag),
        opacity: (0.25 + 0.55 * mag) * (0.45 + 0.55 * fall),
      }))
    }
  }

  const rings = Math.round(lerp(9, 34, densityK))
  const inner = R * 1.22
  const outer = R * (1.7 + 1.5 * spread)

  const ringArc = (rx: number, upper: boolean) => {
    const ry = rx * tilt
    return (
      `M${f(cx - rx)} ${f(cy)}` +
      `A${f(rx)} ${f(ry)} 0 0 ${upper ? 1 : 0} ${f(cx + rx)} ${f(cy)}`
    )
  }

  let accent: string | undefined

  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1)
    const rx = lerp(inner, outer, t) * skel.range(0.99, 1.01)
    const fall = ctx.falloff(cx + rx, cy)
    const gap = skel.bool(0.16)
    if (gap) continue
    const width = u(lerp(1, 4.5, 1 - t) * (0.5 + 0.7 * fall))
    const tone = ctx.ramp(0.34 + 0.5 * fall * (0.5 + 0.5 * (1 - t)))
    const opacity = 0.35 + 0.5 * fall

    // far half of the ring: drawn before the disc, so the disc covers it
    behind.push(el('path', {
      d: ringArc(rx, true), fill: 'none', stroke: tone, 'stroke-width': width,
      opacity, transform: `rotate(${f(rot)} ${f(cx)} ${f(cy)})`,
    }))
    // near half: drawn after everything, crossing over the disc
    front.push(el('path', {
      d: ringArc(rx, false), fill: 'none', stroke: tone, 'stroke-width': width,
      opacity: opacity * 1.15, transform: `rotate(${f(rot)} ${f(cx)} ${f(cy)})`,
    }))
  }

  // the disc itself, banded rather than gradient-shaded
  const bands = 6
  for (let i = 0; i < bands; i++) {
    const t = i / bands
    subject.push(el('path', {
      d: circlePath(cx, cy, R * (1 - t * 0.14)),
      fill: ctx.ramp(0.16 + 0.3 * (1 - t)),
      opacity: 0.55,
    }))
  }

  // the terminator: one lit crescent along the limb, facing the light
  const la = Math.atan2(-light.dy, light.dx)
  const a0 = la - 1.15
  const a1 = la + 1.15
  accent =
    el('path', {
      d: `M${f(cx + Math.cos(a0) * R)} ${f(cy + Math.sin(a0) * R)}` +
        `A${f(R)} ${f(R)} 0 0 1 ${f(cx + Math.cos(a1) * R)} ${f(cy + Math.sin(a1) * R)}`,
      fill: 'none', stroke: palette.accent, 'stroke-width': u(5), 'stroke-linecap': 'round',
    }) +
    el('path', {
      d: `M${f(cx + Math.cos(a0) * (R + u(9)))} ${f(cy + Math.sin(a0) * (R + u(9)))}` +
        `A${f(R + u(9))} ${f(R + u(9))} 0 0 1 ${f(cx + Math.cos(a1) * (R + u(9)))} ${f(cy + Math.sin(a1) * (R + u(9)))}`,
      fill: 'none', stroke: withAlpha(palette.accent, 0.35), 'stroke-width': u(1.6),
    })

  return { back, behind, subject, front, accent }
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
