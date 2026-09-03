import { el, f, lerp, smooth } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * An op-art grid pushed around by a radial lens centred on the focal form.
 * Both line families are drawn through the same displacement, so the warp
 * reads as one surface being deformed rather than two sets of curves — and
 * line weight thickens toward the centre of the lens, which is what sells the
 * bulge without any shading.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'warp', label: 'Warp', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.66 },
  { key: 'turbulence', label: 'Turbulence', type: 'range', min: 0, max: 1, step: 0.01, default: 0.25 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const warpK = ctx.num('warp')
  const turb = ctx.num('turbulence')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const lensR = Math.max(focal.rx, focal.ry) * 1.7
  const push = ctx.short * 0.14 * warpK
  const pinch = skel.bool(0.4) ? -1 : 1

  const displace = (x: number, y: number): [number, number] => {
    const dx = x - focal.cx
    const dy = y - focal.cy
    const dist = Math.hypot(dx, dy) || 1
    const k = Math.max(0, 1 - (dist / lensR) ** 2)
    const amt = pinch * push * k * k
    const wob = ctx.fbm(n(x) * 0.0018, n(y) * 0.0018, 3) * ctx.short * 0.05 * turb
    return [x + (dx / dist) * amt + wob, y + (dy / dist) * amt + wob * 0.6]
  }

  const cells = Math.round(lerp(16, 58, densityK))
  const stepX = w / cells
  const stepY = stepX
  const samples = Math.max(10, Math.round(24 * Math.max(0.5, ctx.quality ** 0.5)))
  const bleed = ctx.short * 0.1

  let accent: string | undefined
  const accentRow = Math.round(focal.cy / stepY)

  const emit = (pts: number[], atCentre: number, isRow: boolean, index: number) => {
    const d = smooth(pts, 0.5)
    const fall = ctx.falloff(focal.cx, atCentre)
    // weight thickens into the lens: the bulge, with no shading at all
    const width = u(lerp(0.7, 3.6, fall) * weightK)
    const line = el('path', {
      d, fill: 'none', stroke: ctx.ramp(0.36 + 0.58 * fall), 'stroke-width': width,
      opacity: 0.5 + 0.5 * fall,
    })
    subject.push(line)
    if (skel.next() < 0.5) ((index % 8 === 3) ? behind : back).push(line)
    if (isRow && index === accentRow && !accent) {
      accent =
        el('path', {
          d, fill: 'none', stroke: palette.accent, 'stroke-width': u(3.4 * weightK),
          'stroke-linecap': 'round',
        }) +
        el('path', {
          d, fill: 'none', stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.2),
          transform: `translate(${f(u(5) * ctx.light.dx)} ${f(-u(5) * ctx.light.dy)})`,
        })
    }
  }

  for (let row = -1; row * stepY < h + bleed; row++) {
    if ((row & 7) === 0 && ctx.expired()) break
    const y = row * stepY
    const pts: number[] = []
    for (let s = 0; s <= samples; s++) {
      const [px, py] = displace(lerp(-bleed, w + bleed, s / samples), y)
      pts.push(px, py)
    }
    emit(pts, y, true, row)
  }

  for (let col = -1; col * stepX < w + bleed; col++) {
    if ((col & 7) === 0 && ctx.expired()) break
    const x = col * stepX
    const pts: number[] = []
    for (let s = 0; s <= samples; s++) {
      const [px, py] = displace(x, lerp(-bleed, h + bleed, s / samples))
      pts.push(px, py)
    }
    emit(pts, focal.cy, false, col)
  }

  // the lens boundary itself, crossing in front
  front.push(el('circle', {
    cx: focal.cx, cy: focal.cy, r: lensR, fill: 'none',
    stroke: withAlpha(ctx.ramp(1), 0.45), 'stroke-width': u(2),
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const warpedGrid: Renderer = {
  id: 'warped-grid',
  name: 'Warped Op-Art Grid',
  family: 'technical',
  dark: true,
  palettes: ['graphite', 'basalt', 'indigo', 'plum', 'chalk', 'bone'],
  focals: ['circle', 'ellipse', 'diamond'],
  sampler: 'grid',
  schema,
  render,
}
