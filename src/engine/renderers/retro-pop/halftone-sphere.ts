import { circlePath, el, f, clamp, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A lit sphere built entirely from halftone dots: the dot radius steps down
 * across four discrete bands running away from the light. No gradient anywhere
 * — the banding is what makes it read as print rather than as a CSS ball.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Dot density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'bands', label: 'Bands', type: 'range', min: 2, max: 7, step: 1, default: 4 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.66 },
  { key: 'field', label: 'Surrounding field', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'skew', label: 'Grid skew', type: 'range', min: 0, max: 1, step: 0.01, default: 0.3 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'disc', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette, light } = ctx
  const densityK = ctx.num('density')
  const bands = Math.max(2, Math.round(ctx.num('bands')))
  const fieldK = ctx.num('field')
  const skew = ctx.num('skew') * skel.range(-1, 1) * 0.5

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const pitch = u(lerp(46, 15, densityK))
  const R = Math.max(focal.rx, focal.ry)
  const dotMax = pitch * 0.52

  // the terminator runs perpendicular to the light, through the sphere
  const lx = light.dx
  const ly = -light.dy

  const cols = Math.ceil(w / pitch) + 4
  const rows = Math.ceil(h / pitch) + 4
  let accent: string | undefined

  for (let row = -2; row < rows - 2; row++) {
    if ((row & 7) === 0 && ctx.expired()) break
    for (let col = -2; col < cols - 2; col++) {
      // offset rows, plus a slight shear, so the grid never reads as a table
      const x = col * pitch + (row % 2 ? pitch * 0.5 : 0) + row * pitch * skew
      const y = row * pitch * 0.87
      const dx = x - focal.cx
      const dy = y - focal.cy
      const dist = Math.hypot(dx, dy)
      const inside = dist <= R

      // discrete lighting bands: how far along the light direction, quantised
      const facing = (dx * lx + dy * ly) / Math.max(R, 1)
      const curve = inside ? Math.sqrt(Math.max(0, 1 - (dist / R) ** 2)) : 0
      const litness = clamp(0.5 + 0.5 * facing + curve * 0.35, 0, 1)
      const band = Math.floor(litness * bands) / (bands - 1)

      const fall = ctx.falloff(x, y)
      const r = inside
        ? dotMax * (0.16 + 0.84 * band)
        : dotMax * fieldK * (0.1 + 0.5 * fall) * (0.4 + 0.6 * skel.next())
      if (r < u(0.6)) continue

      const tone = ctx.ramp(inside ? 0.3 + 0.65 * band : 0.24 + 0.4 * fall)
      const dot = el('circle', {
        cx: x, cy: y, r, fill: tone,
        opacity: inside ? 0.86 + 0.14 * band : 0.3 + 0.4 * fall,
      })
      if (inside) subject.push(dot)
      else back.push(dot)

      // the lit pole: one dot, in the accent, at the brightest point
      if (!accent && inside && band > 0.99 && dist < R * 0.72) {
        accent =
          el('circle', { cx: x, cy: y, r: dotMax * 1.5, fill: palette.accent }) +
          el('circle', {
            cx: x + u(6) * lx, cy: y + u(6) * ly, r: dotMax * 1.5, fill: 'none',
            stroke: withAlpha(palette.accent, 0.45), 'stroke-width': u(1.3),
          })
      }
    }
  }

  // the sphere's own edge, misregistered, plus a ring that crosses in front
  behind.push(el('path', {
    d: circlePath(focal.cx, focal.cy, R * 1.02),
    fill: ctx.ramp(0.08), opacity: 0.7,
  }))
  front.push(el('path', {
    d: `M${f(focal.cx - R * 1.5)} ${f(focal.cy + R * 0.45)}` +
      `A${f(R * 1.5)} ${f(R * 0.42)} 0 0 0 ${f(focal.cx + R * 1.5)} ${f(focal.cy + R * 0.45)}`,
    fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.6), 'stroke-width': u(2.4),
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const halftoneSphere: Renderer = {
  id: 'halftone-sphere',
  name: 'Halftone Sphere',
  family: 'retro-pop',
  dark: true,
  palettes: ['basalt', 'ember', 'plum', 'graphite', 'indigo', 'bone', 'dune'],
  focals: ['circle', 'disc', 'ellipse'],
  sampler: 'grid',
  schema,
  render,
}
