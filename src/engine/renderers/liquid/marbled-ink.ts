import { el, f, lerp, smooth } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Suminagashi. Concentric rings dropped on the surface and then dragged
 * through a domain-warped field — the warp is applied to the sample position
 * before the ring is evaluated, which is what turns concentric circles into
 * combed marbling rather than wobbly circles.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Rings', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'turbulence', label: 'Comb', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.64 },
  { key: 'drops', label: 'Drops', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.45 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'ellipse', 'circle', 'diamond', 'arch'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const comb = ctx.num('turbulence')
  const dropsK = ctx.num('drops')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const warpAmp = ctx.short * 0.22 * comb
  const warp = (x: number, y: number): [number, number] => {
    const a = ctx.fbm(n(x) * 0.0013, n(y) * 0.0013, 4)
    const b = ctx.fbm(n(x) * 0.0013 + 5.2, n(y) * 0.0013 + 1.3, 4)
    // second-order warp: the field displaced by a displaced field
    const a2 = ctx.fbm(n(x) * 0.0021 + a * 2, n(y) * 0.0021 + b * 2, 3)
    return [x + (a + a2 * 0.6) * warpAmp, y + (b + a2 * 0.6) * warpAmp * 1.15]
  }

  const drops = Math.max(1, Math.round(lerp(1, 5, dropsK)))
  // Every ring is a spline of this many cubic segments, so the number
  // multiplies straight into document size: at 84 samples across five drops
  // the source passed a megabyte, which costs far more to parse than the extra
  // smoothness is worth.
  const samples = Math.max(28, Math.round(56 * Math.max(0.4, ctx.quality ** 0.5)))
  let accent: string | undefined
  let accentScore = Infinity

  for (let d = 0; d < drops; d++) {
    const dx = d === 0 ? focal.cx : focal.cx + skel.range(-1, 1) * w * 0.42
    const dy = d === 0 ? focal.cy : focal.cy + skel.range(-1, 1) * h * 0.3
    const rings = Math.max(6, Math.round(lerp(10, 42, densityK) / Math.sqrt(drops)))
    const rMax = ctx.short * lerp(0.35, 1.05, densityK) * skel.range(0.8, 1.3)

    for (let i = 1; i <= rings; i++) {
      if ((i & 15) === 0 && ctx.expired()) break
      const r = (i / rings) * rMax
      const pts: number[] = []
      for (let s = 0; s <= samples; s++) {
        const a = (s / samples) * Math.PI * 2
        const [px, py] = warp(dx + Math.cos(a) * r, dy + Math.sin(a) * r)
        pts.push(px, py)
      }
      const path = `${smooth(pts, 0.5)}Z`
      const fall = ctx.falloff(dx, dy - r * 0.3)
      const width = u(lerp(0.7, 3.6, fall) * weightK * (i % 4 === 0 ? 2.1 : 1))
      const tone = ctx.ramp(0.3 + 0.6 * fall * (0.5 + 0.5 * (1 - i / rings)))

      const ring = el('path', {
        d: path, fill: 'none', stroke: tone, 'stroke-width': width,
        opacity: 0.42 + 0.5 * fall,
      })
      subject.push(ring)
      if (skel.next() < 0.5) ((i + d) % 7 === 3 ? behind : back).push(ring)

      const score = Math.abs(r - focal.rx * 0.8) + (d === 0 ? 0 : ctx.short)
      if (score < accentScore) {
        accentScore = score
        accent =
          el('path', {
            d: path, fill: 'none', stroke: palette.accent, 'stroke-width': u(3.2 * weightK),
          }) +
          el('path', {
            d: path, fill: 'none', stroke: withAlpha(palette.accent, 0.35), 'stroke-width': u(1.2),
            transform: `translate(${f(u(6) * ctx.light.dx)} ${f(-u(6) * ctx.light.dy)})`,
          })
      }
    }
  }

  // a comb stroke dragged across the whole sheet, over the mask edge
  const cy = focal.cy + skel.range(-0.7, 0.7) * focal.ry
  const combPts: number[] = []
  for (let s = 0; s <= 60; s++) {
    const [px, py] = warp(lerp(-u(40), w + u(40), s / 60), cy)
    combPts.push(px, py)
  }
  front.push(el('path', {
    d: smooth(combPts, 0.5), fill: 'none',
    stroke: withAlpha(ctx.ramp(1), 0.55), 'stroke-width': u(2.6 * weightK),
    'stroke-linecap': 'round',
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const marbledInk: Renderer = {
  id: 'marbled-ink',
  name: 'Marbled Ink',
  family: 'liquid',
  dark: true,
  palettes: ['basalt', 'indigo', 'plum', 'ember', 'graphite', 'bone', 'dune'],
  focals: ['ellipse', 'circle', 'diamond', 'arch'],
  sampler: 'field',
  schema,
  render,
}
