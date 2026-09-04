import { packCircles } from '../../sampling'
import { clamp, el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Paper quilling: strips of paper coiled on edge.
 *
 * The whole craft is one observation — a strip of paper has almost no width
 * from the side and a great deal of length, so coiling it turns a flat thing
 * into a drawing made of a single continuous line. That is exactly what a
 * spiral stroke is, which is why this reads as the real object rather than as
 * a spiral: the constant stroke width is the paper's thickness, and it must not
 * taper, ever. A tapering spiral is a snail shell.
 *
 * Depth here is shadow and nothing else. The family turns the compositor's
 * lighting passes down to almost nothing, so each coil carries its own hard
 * offset shadow, and the offsets all agree with the one light. Flat colour plus
 * a displaced dark copy is the entire vocabulary of cut paper, and it is enough.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Coils', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'size', label: 'Coil size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'turns', label: 'Turns', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'gauge', label: 'Paper weight', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.45 },
  { key: 'lift', label: 'Lift', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'lens'], default: 'auto' },
]

/** An Archimedean spiral, sampled finely enough that the turns read as curves. */
function spiral(
  cx: number, cy: number, r0: number, r1: number, turns: number, phase: number, squash: number,
): string {
  const steps = Math.max(16, Math.round(turns * 10))
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const a = phase + t * turns * Math.PI * 2
    const r = lerp(r0, r1, t)
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r * squash
    d += `${i === 0 ? 'M' : 'L'}${f(x)} ${f(y)}`
  }
  return d
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, palette, focal } = ctx
  const densityK = ctx.num('density')
  const sizeK = ctx.num('size')
  const turnK = ctx.num('turns')
  const gaugeK = ctx.num('gauge')
  const liftK = ctx.num('lift')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const gauge = u(lerp(2.6, 8, gaugeK))
  const drop = u(lerp(2, 11, liftK))
  const dx = drop * ctx.light.dx
  const dy = -drop * ctx.light.dy
  const shade = withAlpha(mixHex(palette.ink, palette.ground, 0.25), 0.3 + 0.25 * liftK)

  const rMax = u(lerp(80, 230, sizeK))
  const coils = packCircles(ctx, {
    target: Math.round(lerp(32, 115, densityK) * clamp(ctx.quality ** 0.6, 0.3, 2)),
    rMin: rMax * 0.16,
    rMax,
    padding: gauge * 0.6,
  })

  let accent: string | undefined
  let bestScore = Infinity

  for (const c of coils) {
    if (ctx.expired()) break
    const near = ctx.falloff(c.x, c.y)
    const turns = lerp(2.4, 6.2, turnK) * skel.range(0.8, 1.2)
    const squash = skel.range(0.72, 1)
    const spin = skel.range(0, Math.PI * 2)
    const tone = ctx.ramp(0.2 + 0.75 * skel.next() * (0.55 + 0.45 * near))

    // Three shapes, one craft. A loose coil is the default, a teardrop is a
    // coil pinched at one point, and a scroll is a strip curled from both ends.
    const roll = skel.next()
    let d: string
    let pinch = ''
    if (roll < 0.58) {
      d = spiral(c.x, c.y, c.r * 0.1, c.r, turns, spin, squash)
    } else if (roll < 0.82) {
      d = spiral(c.x, c.y, c.r * 0.12, c.r * 0.9, turns, spin, squash)
      // the pinch: two straight runs meeting at a point outside the coil
      const px = c.x + Math.cos(spin) * c.r * 1.5
      const py = c.y + Math.sin(spin) * c.r * 1.5 * squash
      pinch =
        `M${f(c.x + Math.cos(spin + 1.6) * c.r * 0.9)} ${f(c.y + Math.sin(spin + 1.6) * c.r * 0.9 * squash)}` +
        `L${f(px)} ${f(py)}` +
        `L${f(c.x + Math.cos(spin - 1.6) * c.r * 0.9)} ${f(c.y + Math.sin(spin - 1.6) * c.r * 0.9 * squash)}`
    } else {
      const half = c.r * 0.55
      d =
        spiral(c.x - half, c.y, c.r * 0.08, half, turns * 0.6, spin, squash) +
        spiral(c.x + half, c.y, c.r * 0.08, half, turns * 0.6, spin + Math.PI, squash)
    }

    const strip = d + pinch
    const coil =
      // the shadow, first and underneath
      el('path', {
        d: strip, fill: 'none', stroke: shade, 'stroke-width': gauge,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        transform: `translate(${f(dx)} ${f(dy)})`,
      }) +
      // the paper
      el('path', {
        d: strip, fill: 'none', stroke: tone, 'stroke-width': gauge,
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }) +
      // the lit top edge of the strip, a hairline against the light
      el('path', {
        d: strip, fill: 'none',
        stroke: withAlpha(ctx.ramp(0.06), 0.5),
        'stroke-width': gauge * 0.24, 'stroke-linecap': 'round',
        transform: `translate(${f(-dx * 0.35)} ${f(-dy * 0.35)})`,
      })

    subject.push(coil)
    if (skel.bool(0.62)) back.push(coil)
    else behind.push(coil)

    const score = Math.hypot(c.x - focal.cx, c.y - focal.cy) / Math.max(c.r, 1)
    if (score < bestScore && c.r > rMax * 0.5) {
      bestScore = score
      accent =
        el('path', {
          d: strip, fill: 'none', stroke: withAlpha(palette.ink, 0.28),
          'stroke-width': gauge, 'stroke-linecap': 'round',
          transform: `translate(${f(dx)} ${f(dy)})`,
        }) +
        el('path', {
          d: strip, fill: 'none', stroke: palette.accent, 'stroke-width': gauge * 1.1,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        })
    }
  }

  // One strip left uncoiled, running across the form edge and off the frame —
  // the length the coils are made of, shown once so the rest reads as paper.
  const a = skel.range(0, Math.PI * 2)
  const len = ctx.short * 1.4
  const sx = focal.cx - Math.cos(a) * len * 0.5
  const sy = focal.cy - Math.sin(a) * len * 0.5
  const ribbon =
    `M${f(sx)} ${f(sy)}` +
    `Q${f(focal.cx + Math.sin(a) * ctx.short * skel.range(-0.3, 0.3))} ` +
    `${f(focal.cy - Math.cos(a) * ctx.short * skel.range(-0.3, 0.3))} ` +
    `${f(sx + Math.cos(a) * len)} ${f(sy + Math.sin(a) * len)}`
  front.push(
    el('path', {
      d: ribbon, fill: 'none', stroke: shade, 'stroke-width': gauge * 1.6,
      'stroke-linecap': 'round', transform: `translate(${f(dx)} ${f(dy)})`,
    }),
    el('path', {
      d: ribbon, fill: 'none', stroke: ctx.ramp(0.7), 'stroke-width': gauge * 1.6,
      'stroke-linecap': 'round',
    }),
  )

  return accent
    ? { back, behind, subject, front, accent }
    : { back, behind, subject, front }
}

export const quilling: Renderer = {
  id: 'quilling',
  name: 'Quilling',
  family: 'papercut',
  dark: false,
  focals: ['circle', 'ellipse', 'lens'],
  sampler: 'field',
  schema,
  render,
}
