import { clamp, el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Sedimentary layers, cut by a fault.
 *
 * A stack of wavy horizontal bands is wallpaper. What makes it geology is the
 * fault: a vertical line where the whole stack jumps, so the same band is
 * matched across the break at two different heights. That single displacement
 * carries the entire idea — it is evidence of an event, and it turns a texture
 * into a record of something that happened to the rock.
 *
 * So the frame is divided into slabs, every layer boundary is one continuous
 * function of x, and each slab draws that same function shifted by its own
 * throw. Every band therefore matches itself across every break, which is the
 * whole point; generating each slab independently gives a picture where the
 * layers do not correspond, and a geologist would call that not a fault but a
 * mistake.
 *
 * Layer thicknesses are drawn from a long-tailed roll rather than evenly,
 * because deposition is episodic: a few thick beds, many thin ones, and the
 * occasional dark seam that is worth more to the eye than the beds around it.
 */

const schema: ParamSchema = [
  { key: 'layers', label: 'Layers', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'faults', label: 'Faults', type: 'range', min: 0, max: 4, step: 1, default: 2 },
  { key: 'throw', label: 'Throw', type: 'range', min: 0.05, max: 1, step: 0.01, default: 0.45 },
  { key: 'fold', label: 'Folding', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'clasts', label: 'Inclusions', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'portal', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, palette } = ctx
  const layerK = ctx.num('layers')
  const faultCount = clamp(Math.round(ctx.num('faults')), 0, 4)
  const throwK = ctx.num('throw')
  const foldK = ctx.num('fold')
  const clastK = ctx.num('clasts')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  // --- the bed boundaries, as one function of x ----------------------------
  const tilt = skel.range(-0.16, 0.16)
  const wave = lerp(900, 260, foldK)
  const amp = ctx.short * lerp(0.005, 0.09, foldK)
  const phase = skel.range(0, 500)

  /** The height of boundary `i` at x, before any fault throw. */
  const boundary = (base: number, i: number, x: number): number =>
    base +
    tilt * (x - w / 2) +
    ctx.fbm((n(x) + phase + i * 37) / wave, (i * 0.7 + phase) / 300, 3) * amp +
    Math.sin((x / w) * Math.PI * 2 * (1 + foldK * 2) + i * 0.3) * amp * 0.4

  // Beds: a long tail, so a few are thick and most are thin.
  const beds: { base: number; tone: string; seam: boolean }[] = []
  const span = h * 1.5
  let y = -h * 0.25
  const thin = ctx.short * lerp(0.055, 0.013, layerK)
  while (y < span && beds.length < 90) {
    const seam = skel.next() < 0.18
    const thick = seam ? thin * skel.range(0.12, 0.3) : thin * (0.4 + skel.next() ** 2 * 2.6)
    const shade = skel.next()
    beds.push({
      base: y,
      tone: seam
        ? mixHex(ctx.ramp(0.9), palette.ink, 0.35)
        : ctx.ramp(0.14 + 0.7 * shade * shade),
      seam,
    })
    y += thick
  }

  // --- the slabs -----------------------------------------------------------
  const cuts: number[] = [-u(40)]
  for (let i = 0; i < faultCount; i++) cuts.push(w * ((i + 1) / (faultCount + 1)) + skel.range(-0.12, 0.12) * w)
  cuts.push(w + u(40))
  cuts.sort((a, b) => a - b)

  const throws = cuts.map((_, i) => (i === 0 ? 0 : skel.range(-1, 1) * ctx.short * lerp(0.05, 0.3, throwK)))
  // cumulative, so each fault displaces everything beyond it
  for (let i = 1; i < throws.length; i++) throws[i] = (throws[i - 1] as number) + (throws[i] as number)

  const rock: string[] = []
  for (let s = 0; s < cuts.length - 1; s++) {
    if (ctx.expired()) break
    const x0 = cuts[s] as number
    const x1 = cuts[s + 1] as number
    const dy = throws[s] as number
    const steps = Math.max(6, Math.round(((x1 - x0) / w) * 40))

    for (let i = 0; i < beds.length - 1; i++) {
      const top = beds[i] as (typeof beds)[number]
      const bottom = beds[i + 1] as (typeof beds)[number]
      // skip beds entirely off frame for this slab
      if (boundary(top.base, i, (x0 + x1) / 2) + dy > h + u(20)) continue
      if (boundary(bottom.base, i + 1, (x0 + x1) / 2) + dy < -u(20)) continue

      let d = ''
      for (let k = 0; k <= steps; k++) {
        const x = x0 + ((x1 - x0) * k) / steps
        d += `${k === 0 ? 'M' : 'L'}${f(x)} ${f(boundary(top.base, i, x) + dy)}`
      }
      for (let k = steps; k >= 0; k--) {
        const x = x0 + ((x1 - x0) * k) / steps
        d += `L${f(x)} ${f(boundary(bottom.base, i + 1, x) + dy)}`
      }
      rock.push(el('path', { d: `${d}Z`, fill: top.tone }))

      // the bedding plane itself, one hairline on the lit side
      if (!top.seam && skel.bool(0.72)) {
        let line = ''
        for (let k = 0; k <= steps; k++) {
          const x = x0 + ((x1 - x0) * k) / steps
          line += `${k === 0 ? 'M' : 'L'}${f(x)} ${f(boundary(top.base, i, x) + dy)}`
        }
        rock.push(el('path', {
          d: line, fill: 'none',
          stroke: withAlpha(ctx.ramp(0.04), 0.22), 'stroke-width': u(0.9),
        }))
      }

      // --- clasts: pebbles caught in the bed --------------------------------
      if (clastK > 0.03 && !top.seam && skel.bool(0.2 * clastK + 0.05)) {
        const pebbles = Math.round(lerp(1, 9, clastK))
        for (let p = 0; p < pebbles; p++) {
          const x = skel.range(x0, x1)
          const yTop = boundary(top.base, i, x) + dy
          const yBot = boundary(bottom.base, i + 1, x) + dy
          if (yBot - yTop < u(6)) break
          const cy = skel.range(yTop + u(2), yBot - u(2))
          const r = Math.min((yBot - yTop) * 0.34, u(skel.range(2, 9)))
          rock.push(el('ellipse', {
            cx: x, cy, rx: r * skel.range(1, 1.9), ry: r,
            fill: ctx.ramp(clamp(0.2 + skel.range(0.2, 0.8), 0, 1)),
            opacity: 0.7,
          }))
        }
      }
    }

    // --- the fault plane ---------------------------------------------------
    if (s < cuts.length - 2) {
      rock.push(
        el('path', {
          d: `M${f(x1)} ${f(-u(20))}V${f(h + u(20))}`,
          stroke: withAlpha(palette.ink, 0.55), 'stroke-width': u(3.2), fill: 'none',
        }),
        el('path', {
          d: `M${f(x1 + u(1.8))} ${f(-u(20))}V${f(h + u(20))}`,
          stroke: withAlpha(ctx.ramp(0.06), 0.35), 'stroke-width': u(1.2), fill: 'none',
        }),
      )
    }
  }

  const stack = rock.join('')
  subject.push(stack)
  behind.push(stack)
  back.push(el('g', { opacity: 0.85 }, stack))

  // A vein cutting across every bed and every fault, later than all of it.
  const vx = w * skel.range(0.15, 0.85)
  let vd = `M${f(vx)} ${f(-u(20))}`
  for (let i = 1; i <= 22; i++) {
    const t = i / 22
    vd += `L${f(vx + Math.sin(t * 6 + skel.range(0, 1)) * ctx.short * 0.07)} ${f(t * (h + u(40)) - u(20))}`
  }
  front.push(
    el('path', {
      d: vd, fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.55),
      'stroke-width': u(5), 'stroke-linecap': 'round',
    }),
    el('path', {
      d: vd, fill: 'none', stroke: withAlpha(ctx.ramp(0.04), 0.4),
      'stroke-width': u(1.6), 'stroke-linecap': 'round',
    }),
  )

  // --- the accent: the marker bed -----------------------------------------
  const mi = skel.int(2, Math.max(2, beds.length - 3))
  const top = beds[mi] as (typeof beds)[number]
  const bottom = beds[mi + 1] as (typeof beds)[number]
  let ad = ''
  const parts: string[] = []
  for (let s = 0; s < cuts.length - 1; s++) {
    const x0 = cuts[s] as number
    const x1 = cuts[s + 1] as number
    const dy = throws[s] as number
    ad = ''
    for (let k = 0; k <= 20; k++) {
      const x = x0 + ((x1 - x0) * k) / 20
      ad += `${k === 0 ? 'M' : 'L'}${f(x)} ${f(boundary(top.base, mi, x) + dy)}`
    }
    for (let k = 20; k >= 0; k--) {
      const x = x0 + ((x1 - x0) * k) / 20
      ad += `L${f(x)} ${f(boundary(bottom.base, mi + 1, x) + dy)}`
    }
    parts.push(el('path', { d: `${ad}Z`, fill: palette.accent }))
  }
  const accent = parts.join('')

  return { back, behind, subject, front, accent }
}

export const strataFault: Renderer = {
  id: 'strata-fault',
  name: 'Strata Fault',
  family: 'mineral',
  dark: true,
  focals: ['circle', 'portal', 'ellipse'],
  sampler: 'grid',
  schema,
  render,
}
