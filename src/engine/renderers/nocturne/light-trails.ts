import { el, lerp, smooth } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A long exposure of moving traffic.
 *
 * The subject of a light-trail photograph is time, and the only way to draw
 * time is to draw the same thing twice with a gap. So every trail here is a
 * pair: two parallel streaks a fixed distance apart, riding the same spine.
 * One pair is a vehicle. A single line would be a stroke; two lines held apart
 * and bending together are unmistakably an object that went past.
 *
 * The two other rules are what stop it reading as spaghetti. Lanes share a
 * spine field, so trails run together rather than crossing at random — traffic
 * follows a road. And every trail is brightest in the middle of its run and
 * fades at both ends, because the shutter opened while the car was already
 * somewhere and closed while it still was.
 */

const schema: ParamSchema = [
  { key: 'lanes', label: 'Lanes', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.5 },
  { key: 'sweep', label: 'Curve', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'gauge', label: 'Trail width', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.45 },
  { key: 'glow', label: 'Glow', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'grade', label: 'Lane spread', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.55 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'ellipse', 'circle', 'portal'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, palette } = ctx
  const laneK = ctx.num('lanes')
  const sweepK = ctx.num('sweep')
  const gaugeK = ctx.num('gauge')
  const glowK = ctx.num('glow')
  const gradeK = ctx.num('grade')


  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const core = mixHex(ctx.ramp(1), '#FFF4E2', 0.55)
  const gauge = u(lerp(1.6, 6.5, gaugeK))

  // The road: one direction for the whole frame, with a lazy curve on it.
  const heading = skel.range(0, Math.PI * 2)
  const curve = lerp(0, 0.9, sweepK) * (skel.bool() ? 1 : -1)
  const wave = lerp(900, 340, sweepK)
  const phase = skel.range(0, 500)

  /**
   * The taper is cut into the geometry, not masked over it.
   *
   * The obvious way to fade both ends of a trail is a gradient in a mask, and
   * it is a trap: a mask defaults to userSpaceOnUse for its CONTENT even when
   * its own units are the bounding box, so the fractional rect that looks right
   * is a one-pixel square and every trail disappears. Splitting the spine into
   * overlapping runs and giving each its own opacity needs no units at all, and
   * it is what actually happened — a long exposure is a sum of moments.
   */
  const RUNS = 6

  /** Walk the spine field from a start point, out to both frame edges. */
  const spine = (x0: number, y0: number, drift: number): number[] => {
    const step = ctx.short * 0.045
    const out: number[] = []
    for (const sign of [-1, 1]) {
      const run: number[] = []
      let x = x0
      let y = y0
      for (let i = 0; i < 70; i++) {
        run.push(x, y)
        const bend =
          curve * ctx.fbm((n(x) + phase) / wave, (n(y) - phase) / wave, 2) * 0.9 + drift
        const a = heading + bend
        x += Math.cos(a) * step * sign
        y += Math.sin(a) * step * sign
        if (x < -ctx.short * 0.4 || x > w + ctx.short * 0.4) break
        if (y < -ctx.short * 0.4 || y > h + ctx.short * 0.4) break
      }
      if (sign === -1) {
        for (let i = run.length - 2; i >= 0; i -= 2) out.push(run[i] as number, run[i + 1] as number)
      } else {
        out.push(...run.slice(2))
      }
    }
    return out
  }

  /** One streak: a wash, a body and a filament, over runs that fade at the ends. */
  const streak = (pts: number[], tone: string, k: number): string => {
    const n = pts.length / 2
    if (n < 4) return ''
    let out = ''
    for (let r = 0; r < RUNS; r++) {
      const a = Math.floor((r / RUNS) * (n - 1))
      const b = Math.min(n - 1, Math.ceil(((r + 1) / RUNS) * (n - 1)) + 1)
      if (b - a < 2) continue
      const run = pts.slice(a * 2, (b + 1) * 2)
      // brightest through the middle of the run, nothing at either end
      const env = Math.sin(((r + 0.5) / RUNS) * Math.PI) ** 0.55
      const d = smooth(run, 0.5)
      out +=
        el('path', {
          d, fill: 'none', stroke: withAlpha(tone, 0.16 * glowK * env),
          'stroke-width': gauge * 7 * k, 'stroke-linecap': 'round',
        }) +
        el('path', {
          d, fill: 'none', stroke: withAlpha(tone, (0.4 + 0.35 * glowK) * env),
          'stroke-width': gauge * 2.6 * k, 'stroke-linecap': 'round',
        }) +
        el('path', {
          d, fill: 'none', stroke: withAlpha(core, 0.9 * env),
          'stroke-width': gauge * 0.85 * k, 'stroke-linecap': 'round',
        })
    }
    return out
  }

  // --- the lanes -----------------------------------------------------------
  const lanes = Math.round(lerp(3, 16, laneK))
  const spreadPx = ctx.short * lerp(0.12, 0.62, gradeK)
  // across the road, so lanes stack side by side rather than scattering
  const acrossX = -Math.sin(heading)
  const acrossY = Math.cos(heading)
  const anchorX = w * skel.range(0.3, 0.7)
  const anchorY = h * skel.range(0.3, 0.7)

  for (let i = 0; i < lanes; i++) {
    if (ctx.expired()) break
    const t = lanes === 1 ? 0.5 : i / (lanes - 1)
    const off = (t - 0.5) * 2 * spreadPx * (0.6 + 0.8 * skel.next()) + skel.range(-1, 1) * u(40)
    const x0 = anchorX + acrossX * off
    const y0 = anchorY + acrossY * off
    const pts = spine(x0, y0, skel.range(-0.06, 0.06))
    if (pts.length < 8) continue

    // The pair. Headlights run one way and tail lights the other, so the two
    // halves of the road take opposite ends of the ramp.
    const outbound = t < 0.5
    const tone = outbound ? ctx.ramp(0.95) : ctx.ramp(0.45)
    const sep = gauge * skel.range(1.8, 3.6)
    const near = ctx.falloff(x0, y0)
    const k = (0.4 + 1.1 * near) * (0.45 + skel.next() ** 2 * 1.9)

    for (const s of [-0.5, 0.5]) {
      const shifted: number[] = []
      for (let p = 0; p < pts.length; p += 2) {
        shifted.push(
          (pts[p] as number) + acrossX * sep * s,
          (pts[p + 1] as number) + acrossY * sep * s,
        )
      }
      const mark = streak(shifted, tone, k)
      if (!mark) continue
      // two copies, not three: behind covers the frame and subject lifts the
      // density inside the form, so a third pass into back is pure payload
      behind.push(mark)
      subject.push(mark)
    }
  }

  // --- street lamps, receding ----------------------------------------------
  const lamps = skel.int(4, 9)
  for (let i = 0; i < lamps; i++) {
    const t = (i + 0.5) / lamps
    const off = (skel.range(0.55, 1.15)) * spreadPx * (skel.bool() ? 1 : -1)
    const along = (t - 0.5) * 2 * Math.hypot(w, h) * 0.55
    const x = anchorX + acrossX * off + Math.cos(heading) * along
    const y = anchorY + acrossY * off + Math.sin(heading) * along
    if (x < -u(40) || x > w + u(40) || y < -u(40) || y > h + u(40)) continue
    const r = u(skel.range(3, 9)) * (0.6 + 0.7 * ctx.falloff(x, y))
    back.push(
      el('circle', { cx: x, cy: y, r: r * 5, fill: withAlpha(ctx.ramp(0.9), 0.08 * glowK) }),
      el('circle', { cx: x, cy: y, r, fill: withAlpha(core, 0.75) }),
    )
  }

  // A single trail crossing the form and leaving the frame at speed.
  const heroPts = spine(w * skel.range(0.2, 0.8), h * skel.range(0.2, 0.8), skel.range(-0.1, 0.1))
  if (heroPts.length > 8) {
    front.push(el('path', {
      d: smooth(heroPts, 0.5), fill: 'none',
      stroke: withAlpha(core, 0.5), 'stroke-width': gauge * 0.9,
      'stroke-linecap': 'round',
    }))
  }

  // --- the accent: the one vehicle caught mid-frame ------------------------
  const ax = anchorX + acrossX * skel.range(-0.4, 0.4) * spreadPx
  const ay = anchorY + acrossY * skel.range(-0.4, 0.4) * spreadPx
  const acc = spine(ax, ay, 0)
  const accent = acc.length > 8
    ? el('path', {
        d: smooth(acc, 0.5), fill: 'none', stroke: withAlpha(palette.accent, 0.16),
        'stroke-width': gauge * 7, 'stroke-linecap': 'round',
      }) +
      el('path', {
        d: smooth(acc, 0.5), fill: 'none', stroke: palette.accent,
        'stroke-width': gauge * 1.5, 'stroke-linecap': 'round',
      }) +
      el('circle', { cx: ax, cy: ay, r: gauge * 2.4, fill: mixHex(palette.accent, '#FFF4E2', 0.5) })
    : el('circle', { cx: ax, cy: ay, r: gauge * 3, fill: palette.accent })

  return { back, behind, subject, front, accent }
}

export const lightTrails: Renderer = {
  id: 'light-trails',
  name: 'Light Trails',
  family: 'nocturne',
  dark: true,
  focals: ['ellipse', 'circle', 'portal'],
  sampler: 'field',
  schema,
  render,
}
