import { el, f, lerp, smooth } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Thin-film interference. Two families of displaced bands crossing at a shallow
 * angle, each band stepping to the next stop on the ramp — where the families
 * overlap the steps beat against each other and produce the sheen, without ever
 * leaving the palette.
 *
 * An earlier version traced true iso-contours of the noise field by searching
 * vertically for level crossings. Don't: with no guarantee the crossing is
 * unique along the search line, the trace snaps between distant branches and
 * the output is a picket fence. Displacing a known curve is stable by
 * construction.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Band count', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'turbulence', label: 'Film', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'sheen', label: 'Sheen', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'ellipse', 'circle', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, focal, palette } = ctx
  const densityK = ctx.num('density')
  const filmK = ctx.num('turbulence')
  const sheenK = ctx.num('sheen')
  const weightK = ctx.num('weight')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const scale = lerp(0.0009, 0.0026, filmK)
  const amp = ctx.short * lerp(0.06, 0.28, filmK)
  const samples = Math.max(20, Math.round(46 * Math.max(0.45, ctx.quality ** 0.5)))
  const bleed = ctx.short * 0.14

  let accent: string | undefined
  let accentScore = Infinity

  // two families, crossing at a shallow angle so the steps beat against each other
  const families = [
    { angle: skel.range(-0.28, 0.28), phase: skel.range(0, 9), weight: 1, op: 1 },
    { angle: skel.range(-0.28, 0.28) + skel.range(0.5, 1.1), phase: skel.range(0, 9), weight: 0.7, op: 0.6 },
  ]

  families.forEach((fam, fi) => {
    const bands = Math.round(lerp(16, 62, densityK) * (fi === 0 ? 1 : 0.7))
    const ca = Math.cos(fam.angle)
    const sa = Math.sin(fam.angle)
    const span = Math.hypot(w, h) + bleed * 2

    for (let b = 0; b < bands; b++) {
      if ((b & 7) === 0 && ctx.expired()) break
      const t = b / (bands - 1)
      // band centre along the family's normal
      const off = lerp(-span * 0.55, span * 0.55, t)
      const pts: number[] = []
      for (let s = 0; s <= samples; s++) {
        const along = lerp(-span * 0.55, span * 0.55, s / samples)
        const bx = focal.cx + ca * along - sa * off
        const by = focal.cy + sa * along + ca * off
        const d = ctx.fbm(n(bx) * scale + fam.phase, n(by) * scale, 4)
        pts.push(bx - sa * d * amp, by + ca * d * amp)
      }

      const midX = pts[Math.floor(pts.length / 2) & ~1] as number
      const midY = pts[(Math.floor(pts.length / 2) & ~1) + 1] as number
      const fall = ctx.falloff(midX, midY)
      const d = smooth(pts, 0.5)
      const heavy = b % 5 === 0
      const width = u(lerp(0.8, 3.6, fall) * weightK * fam.weight * (heavy ? 2 : 1))
      // the sheen: each band steps to the next stop rather than sitting on one
      const step = ((b * 0.38) % 1)
      const tone = ctx.ramp(0.2 + 0.7 * lerp(0.5, step, sheenK) + 0.1 * fall)

      const contour = el('path', {
        d, fill: 'none', stroke: tone, 'stroke-width': width,
        opacity: (0.32 + 0.5 * fall) * fam.op, 'stroke-linecap': 'round',
      })
      subject.push(contour)
      if (skel.next() < 0.5) (b % 6 === 2 ? behind : back).push(contour)

      const score = Math.hypot(midX - focal.cx, midY - focal.cy) + fi * ctx.short
      if (score < accentScore) {
        accentScore = score
        accent =
          el('path', {
            d, fill: 'none', stroke: palette.accent, 'stroke-width': u(3.4 * weightK),
            'stroke-linecap': 'round',
          }) +
          el('path', {
            d, fill: 'none', stroke: withAlpha(palette.accent, 0.35), 'stroke-width': u(1.2),
            transform: `translate(${f(u(6) * ctx.light.dx)} ${f(-u(6) * ctx.light.dy)})`,
          })
      }
    }
  })

  // a bright rim where the film breaks, crossing the mask edge
  const r = Math.max(focal.rx, focal.ry) * 1.08
  const a0 = skel.range(0, Math.PI * 2)
  const a1 = a0 + skel.range(1.1, 2.6)
  front.push(el('path', {
    d: `M${f(focal.cx + Math.cos(a0) * r)} ${f(focal.cy + Math.sin(a0) * r)}` +
      `A${f(r)} ${f(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ` +
      `${f(focal.cx + Math.cos(a1) * r)} ${f(focal.cy + Math.sin(a1) * r)}`,
    fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.6), 'stroke-width': u(2.4),
    'stroke-linecap': 'round',
  }))

  return accent ? { back, behind, subject, front, accent } : { back, behind, subject, front }
}

export const oilSlick: Renderer = {
  id: 'oil-slick',
  name: 'Oil Slick',
  family: 'liquid',
  dark: true,
  focals: ['ellipse', 'circle', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
