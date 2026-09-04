import { clamp, el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A city from across the water.
 *
 * Three ranks of buildings at three tones, and the tones are the depth: the
 * far rank is only just off the sky, the near rank is nearly the ink, and the
 * eye reads that as distance without a single line of perspective. This is
 * aerial perspective doing the work that a vanishing point does in the
 * architectural family, and it is the correct tool here — a skyline is seen
 * from far enough away that its verticals really are parallel.
 *
 * Windows are the texture and they are lit by rule rather than at random.
 * A tower with an even scatter of lights reads as static; real ones are lit in
 * runs, because floors are occupied in blocks, so the odds of a window being on
 * are raised by its neighbours below. That one dependency is the difference
 * between a grid of dots and a building at night.
 *
 * The glow above the roofline is the last piece. A city under cloud throws its
 * own light back down, and without it the buildings sit against a flat sky like
 * a cut-out.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Buildings', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'height', label: 'Height', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'windows', label: 'Lit windows', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'haze', label: 'Sky glow', type: 'range', min: 0, max: 1, step: 0.01, default: 0.62 },
  { key: 'ranks', label: 'Depth', type: 'range', min: 1, max: 4, step: 1, default: 3 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'disc', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, palette, baseline, uid } = ctx
  const densityK = ctx.num('density')
  const heightK = ctx.num('height')
  const winK = ctx.num('windows')
  const hazeK = ctx.num('haze')
  const rankCount = clamp(Math.round(ctx.num('ranks')), 1, 4)

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const core = mixHex(ctx.ramp(1), '#FFF0D2', 0.45)
  // The skyline sits on the layout's baseline, so it moves with the subject
  // rather than being welded to the bottom of the frame.
  const ground = clamp(baseline + ctx.short * 0.06, h * 0.5, h * 0.96)

  defs.push(
    el('linearGradient',
      {
        id: `${uid}-sky`, gradientUnits: 'userSpaceOnUse',
        x1: 0, y1: ground - ctx.short * 0.55, x2: 0, y2: ground,
      },
      el('stop', { offset: '0%', 'stop-color': ctx.ramp(0.5), 'stop-opacity': 0 }) +
      el('stop', { offset: '55%', 'stop-color': ctx.ramp(0.7), 'stop-opacity': 0.16 }) +
      el('stop', { offset: '100%', 'stop-color': ctx.ramp(0.95), 'stop-opacity': 0.34 })),
  )

  // --- the glow the city throws back at the sky ----------------------------
  if (hazeK > 0.03) {
    back.push(el('rect', {
      x: 0, y: ground - ctx.short * 0.55, width: w, height: ctx.short * 0.55,
      fill: `url(#${uid}-sky)`, opacity: hazeK.toFixed(3),
    }))
  }

  // --- the ranks -----------------------------------------------------------
  for (let rank = 0; rank < rankCount; rank++) {
    // 0 is the farthest, and the far ones sit higher up the frame
    const depth = rankCount === 1 ? 1 : rank / (rankCount - 1)
    const tone = mixHex(ctx.ramp(0.4), palette.ink, lerp(0.25, 0.94, depth))
    const rim = withAlpha(ctx.ramp(0.9), lerp(0.16, 0.5, depth))
    const rankBase = ground + depth * ctx.short * 0.1
    const scale = lerp(0.55, 1.25, depth)
    const slab: string[] = []
    const lights: string[] = []

    const wide = u(lerp(120, 46, densityK)) * scale
    let x = -wide
    while (x < w + wide) {
      if (ctx.expired()) break
      const bw = wide * skel.range(0.55, 1.6)
      const tall = ctx.short * lerp(0.1, 0.46, heightK) * scale * (0.35 + skel.next() ** 1.7 * 1.6)
      const top = rankBase - tall
      // a stepped crown on some of them, so the roofline is not a bar chart
      const stepped = skel.bool(0.55)
      const inset = bw * skel.range(0.12, 0.3)
      const cap = tall * skel.range(0.08, 0.22)

      slab.push(el('path', {
        d: stepped
          ? `M${f(x)} ${f(rankBase)}V${f(top + cap)}H${f(x + inset)}V${f(top)}` +
            `H${f(x + bw - inset)}V${f(top + cap)}H${f(x + bw)}V${f(rankBase)}Z`
          : `M${f(x)} ${f(rankBase)}V${f(top)}H${f(x + bw)}V${f(rankBase)}Z`,
        fill: tone,
      }))
      // the lit rim on the side facing the light, one hairline
      slab.push(el('path', {
        d: ctx.light.dx > 0
          ? `M${f(x + bw)} ${f(rankBase)}V${f(top + (stepped ? cap : 0))}`
          : `M${f(x)} ${f(rankBase)}V${f(top + (stepped ? cap : 0))}`,
        stroke: rim, 'stroke-width': u(1.2), fill: 'none',
      }))

      // --- windows, lit in runs ---------------------------------------------
      if (winK > 0.02 && depth > 0.25) {
        const gap = u(lerp(26, 13, winK)) * scale
        const cols = Math.max(1, Math.floor((bw - gap) / gap))
        const rowsN = Math.max(1, Math.floor((tall - gap) / gap))
        const pane = gap * 0.44
        const near = ctx.falloff(x + bw / 2, top + tall / 2)
        const base = (0.06 + 0.34 * winK) * (0.5 + 0.7 * near) * depth
        for (let c = 0; c < cols; c++) {
          let onBelow = false
          for (let r = rowsN - 1; r >= 0; r--) {
            // a lit window makes the one above it far more likely
            const p: number = onBelow ? Math.min(0.86, base * 3.2) : base
            onBelow = skel.next() < p
            if (!onBelow) continue
            const wx = x + gap * 0.6 + c * gap
            const wy = rankBase - gap * 0.8 - r * gap
            if (wy < top + cap * 0.4) continue
            lights.push(el('rect', {
              x: wx, y: wy, width: pane, height: pane * 1.35,
              fill: skel.bool(0.14) ? core : ctx.ramp(skel.range(0.6, 1)),
              opacity: skel.range(0.45, 1).toFixed(3),
            }))
          }
        }
      }

      // an aerial mast with a beacon on the tallest of the near ranks
      if (depth > 0.7 && skel.bool(0.18)) {
        const mx = x + bw * 0.5
        const mh = tall * skel.range(0.14, 0.34)
        slab.push(el('path', {
          d: `M${f(mx)} ${f(top)}V${f(top - mh)}`,
          stroke: tone, 'stroke-width': u(2.2), fill: 'none',
        }))
        lights.push(
          el('circle', { cx: mx, cy: top - mh, r: u(6), fill: withAlpha(ctx.ramp(1), 0.16) }),
          el('circle', { cx: mx, cy: top - mh, r: u(1.8), fill: core }),
        )
      }

      x += bw + wide * skel.range(0.02, 0.16)
    }

    const layer = slab.join('') + lights.join('')
    behind.push(layer)
    subject.push(layer)
    if (depth < 0.8) back.push(el('g', { opacity: 0.85 }, layer))
  }

  // --- the water in front --------------------------------------------------
  const waterTop = ground + ctx.short * 0.02
  if (waterTop < h) {
    front.push(el('rect', {
      x: 0, y: waterTop, width: w, height: h - waterTop,
      fill: withAlpha(palette.ink, 0.42),
    }))
    // broken reflections: short horizontal dashes thinning downward
    const dashes = Math.round(lerp(60, 260, winK) * clamp(ctx.quality, 0.3, 2))
    for (let i = 0; i < dashes; i++) {
      const t = ctx.rng.next() ** 1.6
      const y = waterTop + t * (h - waterTop)
      const x0 = ctx.rng.range(0, w)
      const len = u(ctx.rng.range(4, 26)) * (1 + t * 2)
      front.push(el('path', {
        d: `M${f(x0)} ${f(y)}h${f(len)}`,
        stroke: withAlpha(ctx.rng.next() < 0.12 ? core : ctx.ramp(ctx.rng.range(0.6, 1)), 0.5 * (1 - t * 0.7)),
        'stroke-width': u(ctx.rng.range(1, 3.4)), 'stroke-linecap': 'round', fill: 'none',
      }))
    }
  }

  // --- the accent: one tower burning brighter than the rest ----------------
  const ax = w * skel.range(0.2, 0.8)
  const atall = ctx.short * lerp(0.2, 0.6, heightK)
  const abw = u(lerp(90, 40, densityK))
  const accent =
    el('path', {
      d: `M${f(ax)} ${f(ground)}V${f(ground - atall)}H${f(ax + abw)}V${f(ground)}Z`,
      fill: withAlpha(palette.accent, 0.14),
    }) +
    el('path', {
      d: `M${f(ax)} ${f(ground)}V${f(ground - atall)}H${f(ax + abw)}V${f(ground)}`,
      stroke: palette.accent, 'stroke-width': u(2), fill: 'none',
    }) +
    el('circle', { cx: ax + abw / 2, cy: ground - atall - u(14), r: u(4.5), fill: palette.accent })

  return { back, behind, subject, front, defs, accent }
}

export const skylineGlow: Renderer = {
  id: 'skyline-glow',
  name: 'Skyline Glow',
  family: 'nocturne',
  dark: true,
  focals: ['circle', 'disc', 'ellipse'],
  sampler: 'grid',
  schema,
  render,
}
