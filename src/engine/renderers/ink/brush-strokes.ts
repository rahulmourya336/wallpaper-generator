import { clamp, el, f, lerp, smooth } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A few loaded strokes, and a lot of paper.
 *
 * A brush stroke is not a line with a width, it is a shape — the bristles
 * spread under pressure and gather as the hand lifts, so the two sides of the
 * mark are different curves. Everything here follows from drawing it that way:
 * a spine is sampled, a pressure curve gives a half-width at each sample, and
 * the outline is the left offsets followed by the right offsets reversed. A
 * stroked path with a round cap can never do this, which is why every attempt
 * to fake calligraphy with stroke-width looks like a marker pen.
 *
 * Two accidents of the medium finish it. Ink bleeds into paper, so under each
 * mark sits a wider, far paler copy of the same shape. And a fast brush skips,
 * so the tail carries streaks of bare ground running along the direction of
 * travel — the dry-brush gaps are the evidence of speed, and they are the only
 * reason a still image reads as a gesture.
 *
 * The restraint is the design. This family's character sets a very low form
 * fill and almost no atmosphere, because in sumi-e the empty paper is the
 * subject and the ink is what defines its edges.
 */

const schema: ParamSchema = [
  { key: 'strokes', label: 'Strokes', type: 'range', min: 1, max: 12, step: 1, default: 5 },
  { key: 'load', label: 'Brush width', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.5 },
  { key: 'dry', label: 'Dry brush', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'bleed', label: 'Bleed', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'gesture', label: 'Gesture', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.55 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'lens'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, palette, focal } = ctx
  const count = Math.max(1, Math.round(ctx.num('strokes')))
  const loadK = ctx.num('load')
  const dryK = ctx.num('dry')
  const bleedK = ctx.num('bleed')
  const gestureK = ctx.num('gesture')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const ink = ctx.ramp(1)
  const maxHalf = u(lerp(9, 44, loadK))

  /**
   * Build the outline of one stroke from a spine and a pressure curve.
   *
   * The normal is taken from the neighbouring samples rather than from the
   * curve's derivative: the spine is already a polyline and a finite difference
   * is both correct here and immune to the zero-length tangents that appear
   * wherever two samples coincide.
   */
  const strokeBody = (spine: number[], half: (t: number) => number): string => {
    const n = spine.length / 2
    if (n < 3) return ''
    const left: number[] = []
    const right: number[] = []
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const ax = spine[Math.max(0, i - 1) * 2] as number
      const ay = spine[Math.max(0, i - 1) * 2 + 1] as number
      const bx = spine[Math.min(n - 1, i + 1) * 2] as number
      const by = spine[Math.min(n - 1, i + 1) * 2 + 1] as number
      const len = Math.hypot(bx - ax, by - ay) || 1
      const nx = -(by - ay) / len
      const ny = (bx - ax) / len
      const hw = half(t)
      const px = spine[i * 2] as number
      const py = spine[i * 2 + 1] as number
      left.push(px + nx * hw, py + ny * hw)
      right.push(px - nx * hw, py - ny * hw)
    }
    const rev: number[] = []
    for (let i = right.length - 2; i >= 0; i -= 2) rev.push(right[i] as number, right[i + 1] as number)
    return `${smooth([...left, ...rev], 0.4)}Z`
  }

  type Stroke = { d: string; spine: number[]; half: (t: number) => number; tone: string }
  const strokes: Stroke[] = []

  for (let s = 0; s < count; s++) {
    if (ctx.expired()) break
    // Anchored on the subject and thrown outward, so the strokes compose around
    // the focal form instead of scattering over the sheet.
    const a = skel.range(0, Math.PI * 2)
    const reach = ctx.short * lerp(0.35, 1.15, gestureK) * skel.range(0.6, 1.4)
    const x0 = focal.cx + Math.cos(a) * focal.rx * skel.range(-0.9, 0.9)
    const y0 = focal.cy + Math.sin(a) * focal.ry * skel.range(-0.9, 0.9)
    const dir = a + skel.range(-0.6, 0.6)
    const bend = skel.range(-1, 1) * gestureK * 1.5

    const samples = 26
    const spine: number[] = []
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1)
      const curve = bend * Math.sin(t * Math.PI)
      const ang = dir + curve
      spine.push(
        x0 + Math.cos(ang) * reach * t + Math.sin(dir) * curve * reach * 0.16,
        y0 + Math.sin(ang) * reach * t - Math.cos(dir) * curve * reach * 0.16,
      )
    }

    /**
     * Pressure: on hard, held, then lifted to nothing.
     *
     * The attack is fast because a brush is already loaded when it lands, and
     * the release is a power curve because the hand accelerates away. A
     * symmetric profile reads as a leaf, which is the wrong object.
     */
    const peak = maxHalf * skel.range(0.45, 1.25) * (0.55 + 0.6 * ctx.falloff(x0, y0))
    const tail = skel.range(0.85, 2.1)
    const half = (t: number) =>
      peak * Math.min(1, t / 0.05) * Math.pow(1 - t, tail) * (1 + 0.12 * Math.sin(t * 4.5))

    const d = strokeBody(spine, half)
    if (!d) continue
    strokes.push({ d, spine, half, tone: mixHex(ink, palette.ground, skel.range(0, 0.4)) })
  }

  for (const st of strokes) {
    // the bleed, under everything
    if (bleedK > 0.03) {
      behind.push(el('path', {
        d: strokeBody(st.spine, (t) => st.half(t) * (1.25 + 0.5 * bleedK)),
        fill: withAlpha(st.tone, 0.07 + 0.1 * bleedK),
      }))
    }
    const mark = el('path', { d: st.d, fill: st.tone })
    subject.push(mark)
    back.push(mark)

    // --- dry brush ---------------------------------------------------------
    if (dryK > 0.03) {
      const n = st.spine.length / 2
      const streaks = Math.round(lerp(1, 7, dryK))
      for (let k = 0; k < streaks; k++) {
        const off = skel.range(-0.8, 0.8)
        const from = skel.range(0.3, 0.6)
        const pts: number[] = []
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1)
          if (t < from) continue
          const ax = st.spine[Math.max(0, i - 1) * 2] as number
          const ay = st.spine[Math.max(0, i - 1) * 2 + 1] as number
          const bx = st.spine[Math.min(n - 1, i + 1) * 2] as number
          const by = st.spine[Math.min(n - 1, i + 1) * 2 + 1] as number
          const len = Math.hypot(bx - ax, by - ay) || 1
          pts.push(
            (st.spine[i * 2] as number) + (-(by - ay) / len) * st.half(t) * off,
            (st.spine[i * 2 + 1] as number) + ((bx - ax) / len) * st.half(t) * off,
          )
        }
        if (pts.length < 6) continue
        const streak = el('path', {
          d: smooth(pts, 0.4), fill: 'none',
          stroke: palette.ground,
          'stroke-width': u(skel.range(0.8, 3.4)) * dryK,
          'stroke-linecap': 'round',
          opacity: skel.range(0.4, 0.95).toFixed(3),
        })
        subject.push(streak)
        back.push(streak)
      }
    }
  }

  // --- spatter -------------------------------------------------------------
  const spots = Math.round(lerp(4, 40, dryK) * clamp(ctx.quality, 0.3, 2))
  for (let i = 0; i < spots; i++) {
    const x = ctx.rng.range(0, w)
    const y = ctx.rng.range(0, h)
    if (ctx.rng.next() > ctx.density(x, y) * 0.7) continue
    back.push(el('circle', {
      cx: x, cy: y, r: u(ctx.rng.range(0.6, 3.4)),
      fill: withAlpha(ink, ctx.rng.range(0.2, 0.7)),
    }))
  }

  // One stroke laid over the form and off the frame, at full load.
  const oa = skel.range(0, Math.PI * 2)
  const oSpine: number[] = []
  for (let i = 0; i < 20; i++) {
    const t = i / 19
    oSpine.push(
      focal.cx + Math.cos(oa) * (t - 0.35) * ctx.short * 1.9,
      focal.cy + Math.sin(oa) * (t - 0.35) * ctx.short * 1.9 + Math.sin(t * 3.2) * ctx.short * 0.09,
    )
  }
  front.push(el('path', {
    d: strokeBody(oSpine, (t) => maxHalf * 0.7 * Math.min(1, t / 0.06) * Math.pow(1 - t, 1.1)),
    fill: withAlpha(ink, 0.9),
  }))

  // --- the accent: the seal ------------------------------------------------
  const seal = u(lerp(40, 76, loadK))
  const sx = clamp(focal.cx + focal.rx * skel.range(-1.3, 1.3), seal, w - seal * 1.4)
  const sy = clamp(focal.cy + focal.ry * skel.range(0.6, 1.6), seal, h - seal * 1.4)
  const marks: string[] = []
  for (let i = 0; i < 4; i++) {
    const my = sy + seal * (0.22 + i * 0.19)
    marks.push(el('path', {
      d: `M${f(sx + seal * 0.2)} ${f(my)}h${f(seal * skel.range(0.25, 0.6))}`,
      stroke: palette.ground, 'stroke-width': u(3.4), fill: 'none',
    }))
  }
  const accent =
    el('rect', { x: sx, y: sy, width: seal, height: seal, rx: u(4), fill: palette.accent }) +
    marks.join('') +
    el('path', {
      d: `M${f(sx + seal * 0.5)} ${f(sy + seal * 0.18)}V${f(sy + seal * 0.82)}`,
      stroke: palette.ground, 'stroke-width': u(3.4), fill: 'none',
    })

  return { back, behind, subject, front, accent }
}

export const brushStrokes: Renderer = {
  id: 'brush-strokes',
  name: 'Brush Strokes',
  family: 'ink',
  dark: false,
  focals: ['circle', 'ellipse', 'lens'],
  sampler: 'field',
  schema,
  render,
}
