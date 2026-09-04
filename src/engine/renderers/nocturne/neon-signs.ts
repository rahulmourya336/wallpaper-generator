import { clamp, el, f, lerp, smooth } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Neon, and the wet ground under it.
 *
 * A glowing tube is five strokes of the same path, not one stroke with a blur
 * on it. Widths fall geometrically and opacities rise, so the light builds from
 * a broad dim wash to a hot thin core — which is what halation actually is, and
 * it costs a fifth of what a Gaussian costs at export scale. The core is warmed
 * past the top of the ramp toward white, because that is the one thing about
 * neon that no palette stop can express: the middle of a lit tube is blown out.
 *
 * The reflection is the other half of the picture and it is nearly free. The
 * same group is flipped about a line low in the frame, given the wash passes
 * without the core, and faded downward — a wet street returns the glow and
 * loses the filament, so dropping the hottest pass is the whole difference
 * between a reflection and an upside-down copy.
 */

const schema: ParamSchema = [
  { key: 'signs', label: 'Signs', type: 'range', min: 1, max: 8, step: 1, default: 4 },
  { key: 'glow', label: 'Glow', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.62 },
  { key: 'gauge', label: 'Tube gauge', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'wet', label: 'Wet ground', type: 'range', min: 0, max: 1, step: 0.01, default: 0.66 },
  { key: 'bokeh', label: 'Distance lights', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'portal', 'circle', 'ellipse'], default: 'auto' },
]

/** The five passes of a lit tube, dim and broad to hot and thin. */
const PASSES: readonly { w: number; a: number; t: number }[] = [
  { w: 9.5, a: 0.07, t: 0.55 },
  { w: 5.2, a: 0.13, t: 0.7 },
  { w: 2.6, a: 0.26, t: 0.85 },
  { w: 1.15, a: 0.7, t: 1 },
  { w: 0.42, a: 1, t: 1 },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, palette, focal, uid } = ctx
  const signCount = Math.max(1, Math.round(ctx.num('signs')))
  const glowK = ctx.num('glow')
  const gaugeK = ctx.num('gauge')
  const wetK = ctx.num('wet')
  const bokehK = ctx.num('bokeh')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const gauge = u(lerp(2.6, 7, gaugeK))
  // the hot filament: past the ramp, toward a warm white nothing else uses
  const core = mixHex(ctx.ramp(1), '#FFF4E2', 0.62)
  const waterline = h * skel.range(0.72, 0.86)

  defs.push(
    el('linearGradient',
      { id: `${uid}-wet`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: waterline, x2: 0, y2: h },
      el('stop', { offset: '0%', 'stop-color': '#ffffff', 'stop-opacity': 0.55 }) +
      el('stop', { offset: '45%', 'stop-color': '#ffffff', 'stop-opacity': 0.2 }) +
      el('stop', { offset: '100%', 'stop-color': '#ffffff', 'stop-opacity': 0 })),
    el('mask', { id: `${uid}-pool`, maskUnits: 'userSpaceOnUse' },
      el('rect', { x: 0, y: waterline, width: w, height: h - waterline, fill: `url(#${uid}-wet)` })),
  )

  /** One tube, as its five passes. `hot` false drops the core for reflections. */
  const tube = (d: string, tone: string, scale: number, hot: boolean): string => {
    let out = ''
    for (let i = 0; i < PASSES.length; i++) {
      const p = PASSES[i] as (typeof PASSES)[number]
      if (!hot && i >= 3) continue
      out += el('path', {
        d, fill: 'none',
        stroke: i === PASSES.length - 1 ? core : mixHex(tone, core, (p.t - 0.55) * 0.5),
        'stroke-width': gauge * p.w * scale,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: (p.a * (0.45 + 0.55 * glowK)).toFixed(3),
      })
    }
    return out
  }

  // --- distance lights, well behind everything -----------------------------
  if (bokehK > 0.03) {
    const lights = Math.round(lerp(30, 190, bokehK) * clamp(ctx.quality, 0.3, 2))
    for (let i = 0; i < lights; i++) {
      const x = ctx.rng.range(0, w)
      const y = ctx.rng.range(0, waterline)
      const r = u(ctx.rng.range(1.2, 9)) * (0.5 + 0.6 * ctx.falloff(x, y))
      const tone = ctx.ramp(ctx.rng.range(0.55, 1))
      back.push(
        el('circle', { cx: x, cy: y, r: r * 3.2, fill: withAlpha(tone, 0.07) }),
        el('circle', { cx: x, cy: y, r, fill: withAlpha(tone, ctx.rng.range(0.4, 0.9)) }),
      )
    }
  }

  // --- the signs -----------------------------------------------------------
  /**
   * A sign is a short walk on a coarse lattice, smoothed.
   *
   * Free-hand curves came out as noodles: with no right angles anywhere the
   * result reads as ribbon, not as bent glass. Snapping the turns to a lattice
   * and then rounding them gives the cursive-on-a-grid feel that signage has,
   * because signage is bent by hand around a former.
   */
  const signs: { d: string; tone: string; scale: number }[] = []
  for (let s = 0; s < signCount; s++) {
    const step = u(skel.range(48, 120))
    const ox = skel.range(0.1, 0.9) * w
    const oy = skel.range(0.12, 0.78) * waterline
    const legs = skel.int(5, 12)
    const pts: number[] = [ox, oy]
    let x = ox
    let y = oy
    let dir = skel.int(0, 3)
    for (let i = 0; i < legs; i++) {
      // quarter turns only, and never straight back on itself
      dir = (dir + skel.pick([1, 3, 0, 1, 3])) % 4
      const len = step * skel.range(0.7, 2.1)
      x += (dir === 0 ? 1 : dir === 2 ? -1 : 0) * len
      y += (dir === 1 ? 1 : dir === 3 ? -1 : 0) * len
      x = clamp(x, -u(60), w + u(60))
      y = clamp(y, -u(60), waterline + u(40))
      pts.push(x, y)
    }
    const closed = skel.bool(0.62)
    const d = smooth(closed ? [...pts, ox, oy] : pts, 0.42)
    const near = ctx.falloff(ox, oy)
    signs.push({
      d,
      tone: ctx.ramp(skel.range(0.6, 1)),
      scale: (0.55 + 0.75 * near) * skel.range(0.8, 1.25),
    })
  }

  // a ring or two, the way a sign carries a border
  const rings = skel.int(3, 6)
  for (let i = 0; i < rings; i++) {
    const r = Math.max(focal.rx, focal.ry) * skel.range(0.4, 1.25)
    const a0 = skel.range(0, Math.PI * 2)
    const a1 = a0 + skel.range(1.4, Math.PI * 2)
    signs.push({
      d:
        `M${f(focal.cx + Math.cos(a0) * r)} ${f(focal.cy + Math.sin(a0) * r)}` +
        `A${f(r)} ${f(r)} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ` +
        `${f(focal.cx + Math.cos(a1) * r)} ${f(focal.cy + Math.sin(a1) * r)}`,
      tone: ctx.ramp(skel.range(0.7, 1)),
      scale: skel.range(0.7, 1.1),
    })
  }

  const lit = signs.map((s) => tube(s.d, s.tone, s.scale, true)).join('')
  behind.push(lit)
  subject.push(lit)

  // --- the reflection ------------------------------------------------------
  if (wetK > 0.03) {
    const wash = signs.map((s) => tube(s.d, s.tone, s.scale * 1.35, false)).join('')
    back.push(el('g', {
      mask: `url(#${uid}-pool)`,
      opacity: (0.75 * wetK).toFixed(3),
      // flip about the waterline, and stretch: a reflection on a wet plane is
      // foreshortened, and smeared along the direction it runs away from you
      transform:
        `translate(0 ${f(2 * waterline)}) scale(1 -1.35) translate(0 ${f(waterline * (1 - 1 / 1.35))})`,
    }, wash))

    // the sheet of water itself, catching a little of everything above it
    back.push(el('rect', {
      x: 0, y: waterline, width: w, height: h - waterline,
      fill: withAlpha(ctx.ramp(0.55), 0.05 + 0.09 * wetK),
    }))
  }

  // One tube crossing the form edge and running off the frame, so the signs
  // are part of a street rather than an arrangement inside the picture.
  const runY = skel.range(0.2, 0.65) * waterline
  front.push(tube(
    smooth([
      -u(80), runY,
      w * 0.3, runY + skel.range(-1, 1) * u(90),
      w * 0.7, runY + skel.range(-1, 1) * u(90),
      w + u(80), runY + skel.range(-1, 1) * u(60),
    ], 0.5),
    ctx.ramp(0.95), 0.85, true,
  ))

  // --- the accent: one tube burning in the accent colour -------------------
  const pick = signs[skel.int(0, signs.length - 1)] as (typeof signs)[number]
  let accent = ''
  for (let i = 0; i < PASSES.length; i++) {
    const p = PASSES[i] as (typeof PASSES)[number]
    accent += el('path', {
      d: pick.d, fill: 'none',
      stroke: i === PASSES.length - 1 ? mixHex(palette.accent, '#FFF4E2', 0.5) : palette.accent,
      'stroke-width': gauge * p.w * pick.scale,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      opacity: (p.a * (0.5 + 0.5 * glowK)).toFixed(3),
    })
  }

  return { back, behind, subject, front, defs, accent }
}

export const neonSigns: Renderer = {
  id: 'neon-signs',
  name: 'Neon Signs',
  family: 'nocturne',
  dark: true,
  focals: ['portal', 'circle', 'ellipse'],
  sampler: 'field',
  schema,
  render,
}
