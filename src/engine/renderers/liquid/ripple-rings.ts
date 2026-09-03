import { el, f, lerp, smooth } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Interfering wave fronts. Two or three impact points each throw concentric
 * rings, and every ring's radius is modulated by the summed height of all the
 * sources at that bearing — so where two wave trains meet the rings genuinely
 * distort rather than just crossing.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Wave count', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'turbulence', label: 'Chop', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.66 },
  { key: 'sources', label: 'Impacts', type: 'range', min: 1, max: 4, step: 1, default: 2 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const chop = ctx.num('turbulence')
  const sourceCount = Math.max(1, Math.round(ctx.num('sources')))
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const sources = Array.from({ length: sourceCount }, (_, i) =>
    i === 0
      ? { x: focal.cx, y: focal.cy, k: 1 }
      : {
          x: focal.cx + skel.range(-1, 1) * w * 0.55,
          y: focal.cy + skel.range(-1, 1) * h * 0.35,
          k: skel.range(0.4, 0.9),
        })

  const wavelength = ctx.short * lerp(0.09, 0.022, densityK)
  const height = (x: number, y: number) => {
    let s = 0
    for (const src of sources) {
      const d = Math.hypot(x - src.x, y - src.y)
      s += Math.sin((d / wavelength) * Math.PI * 2) * src.k * Math.exp(-d / (ctx.short * 1.6))
    }
    return s / sources.length
  }

  // Samples multiply by rings and again by sources, so this is the single
  // biggest lever on document size in this family. Ninety-six put the source
  // past a megabyte and a half; the extra smoothness was not visible.
  const samples = Math.max(28, Math.round(52 * Math.max(0.4, ctx.quality ** 0.5)))
  const reach = Math.hypot(w, h) * 0.72
  let accent: string | undefined
  let accentScore = Infinity

  sources.forEach((src, si) => {
    const rings = Math.min(46, Math.round(reach / wavelength))
    for (let i = 1; i <= rings; i++) {
      if ((i & 15) === 0 && ctx.expired()) break
      const r0 = i * wavelength
      const pts: number[] = []
      for (let s = 0; s <= samples; s++) {
        const a = (s / samples) * Math.PI * 2
        const bx = src.x + Math.cos(a) * r0
        const by = src.y + Math.sin(a) * r0
        // the ring is pushed by the summed field, so wave trains interfere
        const push =
          height(bx, by) * wavelength * 0.85 +
          ctx.fbm(n(bx) * 0.0026, n(by) * 0.0026, 3) * wavelength * 1.4 * chop
        pts.push(src.x + Math.cos(a) * (r0 + push), src.y + Math.sin(a) * (r0 + push))
      }
      const d = `${smooth(pts, 0.5)}Z`
      const fall = ctx.falloff(src.x, src.y - r0 * 0.25)
      const width = u(lerp(0.7, 3.2, fall) * weightK * (i % 4 === 0 ? 1.8 : 1)) * src.k
      const tone = ctx.ramp(0.3 + 0.6 * fall)

      const ring = el('path', {
        d, fill: 'none', stroke: tone, 'stroke-width': width,
        opacity: (0.34 + 0.5 * fall) * src.k,
      })
      subject.push(ring)
      if (skel.next() < 0.5) ((i + si) % 6 === 2 ? behind : back).push(ring)

      const score = Math.abs(r0 - focal.rx * 0.85) + si * ctx.short
      if (score < accentScore) {
        accentScore = score
        accent =
          el('path', {
            d, fill: 'none', stroke: palette.accent, 'stroke-width': u(3 * weightK),
          }) +
          el('path', {
            d, fill: 'none', stroke: withAlpha(palette.accent, 0.35), 'stroke-width': u(1.2),
            transform: `translate(${f(u(6) * ctx.light.dx)} ${f(-u(6) * ctx.light.dy)})`,
          })
      }
    }
  })

  // the impact marks, and a meniscus crossing in front of the mask
  for (const src of sources) {
    behind.push(el('circle', {
      cx: src.x, cy: src.y, r: wavelength * 0.5,
      fill: ctx.ramp(0.6), opacity: 0.5 * src.k,
    }))
  }
  front.push(el('path', {
    d: `M${f(-u(20))} ${f(focal.cy + focal.ry * 0.9)}` +
      `Q${f(focal.cx)} ${f(focal.cy + focal.ry * 0.55)} ${f(w + u(20))} ${f(focal.cy + focal.ry * 1.05)}`,
    fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.5), 'stroke-width': u(2.4),
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const rippleRings: Renderer = {
  id: 'ripple-rings',
  name: 'Ripple Rings',
  family: 'liquid',
  dark: true,
  palettes: ['basalt', 'indigo', 'verdigris', 'graphite', 'plum', 'seafog'],
  focals: ['circle', 'ellipse', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
