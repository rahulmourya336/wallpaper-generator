import { el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A colonnade of deeply nested arches, over a set of grand arcs that carry the
 * upper frame and a base of piers that bleeds off the bottom.
 *
 * Three things drive the look:
 *
 * - The arc and its legs are separate paths. Drawn as one shape, twenty nested
 *   arches produce forty parallel verticals and the composition reads as a
 *   barcode with caps; splitting them lets the legs sit back at a third of the
 *   weight while the arcs carry the form.
 * - Every ring is paired with a misregistered hairline a few design units off
 *   in the light direction. That is where most of the element count comes from
 *   and what gives the stack its screen-print quality.
 * - The same field is emitted twice, clipped inside the focal form at full
 *   density and outside it at roughly a quarter, so the density step lands on
 *   the mask edge rather than between two unrelated textures.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'turbulence', label: 'Turbulence', type: 'range', min: 0, max: 1, step: 0.01, default: 0.38 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'courses', label: 'Courses', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'arch', 'circle', 'diamond', 'ellipse'], default: 'auto' },
]

type Column = {
  cx: number
  spring: number
  rMax: number
  legLen: number
  rings: number
  near: number
  /** every nth ring is drawn heavier, which gives the stack a printed rhythm */
  beat: number
  /** pier half-width as a fraction of rMax, and where its top sits on the leg */
  pierW: number
  pierTop: number
}

const arcPath = (cx: number, spring: number, r: number) =>
  `M${f(cx - r)} ${f(spring)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + r)} ${f(spring)}`

const legsPath = (cx: number, spring: number, r: number, len: number) =>
  `M${f(cx - r)} ${f(spring)}L${f(cx - r)} ${f(spring + len)}` +
  `M${f(cx + r)} ${f(spring)}L${f(cx + r)} ${f(spring + len)}`

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const field = ctx.rng
  const { w, h, u, n, focal, palette, light } = ctx

  const densityK = ctx.num('density')
  const turb = ctx.num('turbulence')
  const weightK = ctx.num('weight')
  const coursesK = ctx.num('courses')

  const cols = 2 + Math.round(densityK * 3)
  const gap = w / Math.max(1, cols - 1)
  const bottom = h + u(12)

  const focalTop = focal.cy - focal.ry
  const focalBottom = focal.cy + focal.ry
  const focalLeft = focal.cx - focal.rx
  const focalRight = focal.cx + focal.rx

  // --- skeleton: quality-invariant, so a thumbnail is the same colonnade ---
  const columns: Column[] = []
  for (let i = -1; i <= cols; i++) {
    const bx = i * gap
    const nx = n(bx)
    const cx = bx + ctx.fbm(nx * 0.003, 17) * turb * gap * 0.28
    const spring =
      h * (0.62 + ctx.fbm(nx * 0.0019, 41.5) * 0.13 * turb) + skel.range(-1, 1) * u(20)
    const rMax = gap * skel.range(1.05, 1.5) * lerp(0.8, 1.1, ctx.falloff(cx, spring - gap))
    columns.push({
      cx,
      spring,
      rMax,
      legLen: rMax * skel.range(0.34, 0.52),
      rings: Math.max(10, Math.round(13 + 22 * densityK * ctx.density(cx, spring - rMax * 0.6))),
      near: Math.abs(cx - focal.cx) / Math.max(1, focal.rx),
      beat: skel.int(3, 5),
      pierW: skel.range(0.09, 0.17),
      pierTop: skel.range(0.7, 2.1),
    })
  }


  // Anchor the colonnade to the focal form. Columns and focal are placed
  // independently, so without this the nest sometimes lands entirely outside
  // the mask and the composition loses its subject-and-ground read.
  const nearest = columns.reduce((a, b) =>
    Math.abs(a.cx - focal.cx) <= Math.abs(b.cx - focal.cx) ? a : b)
  const shift = Math.max(-gap * 0.5, Math.min(gap * 0.5, focal.cx - nearest.cx))
  for (const col of columns) {
    col.cx += shift
    col.near = Math.abs(col.cx - focal.cx) / Math.max(1, focal.rx)
  }

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const sorted = [...columns].sort((a, b) => a.near - b.near)
  const frontCol = sorted[0] as Column
  const behindCol = (sorted[1] ?? sorted[0]) as Column

  let accent: string | undefined
  let accentScore = Infinity

  // --- drafting grid: quiet texture that carries the empty top third --------
  const gridStep = gap / 6
  for (let x = -gridStep; x < w + gridStep; x += gridStep) {
    const fall = ctx.falloff(x, h * 0.5)
    back.push(el('path', {
      d: `M${f(x)} ${f(-u(24))}L${f(x)} ${f(bottom)}`,
      stroke: ctx.ramp(0.32 + 0.42 * fall),
      'stroke-width': u(1),
      opacity: 0.16 + 0.24 * fall,
      fill: 'none',
    }))
  }

  const courseCount = Math.round(lerp(5, 26, coursesK))
  for (let i = 0; i < courseCount; i++) {
    const y = h * lerp(0.05, 1.02, i / courseCount) + skel.range(-1, 1) * u(8)
    const fall = ctx.falloff(w * 0.5, y)
    const heavy = skel.bool(0.22)
    const line = el('path', {
      d: `M${f(-u(28))} ${f(y)}L${f(w + u(28))} ${f(y)}`,
      stroke: ctx.ramp(0.36 + 0.48 * fall),
      'stroke-width': u(heavy ? 3 + 4 * fall : 1.1),
      opacity: (heavy ? 0.42 : 0.22) + 0.34 * fall,
      fill: 'none',
    })
    back.push(line)
    if (skel.bool(0.35)) subject.push(line)
  }

  // --- grand arcs: concentric with the focal form, running off both edges ---
  const grandSpring = focal.cy + focal.ry * 0.55
  const grandCount = 6 + Math.round(densityK * 5)
  for (let i = 0; i < grandCount; i++) {
    const r = ctx.short * lerp(0.5, 1.55, i / (grandCount - 1)) * skel.range(0.97, 1.04)
    const fall = ctx.falloff(focal.cx, grandSpring - r)
    const arc = el('path', {
      d: arcPath(focal.cx, grandSpring, r),
      fill: 'none',
      stroke: ctx.ramp(0.5 + 0.4 * fall),
      'stroke-width': u(skel.bool(0.25) ? 3.4 : 1.2),
      opacity: 0.2 + 0.3 * fall,
    })
    back.push(arc)
    subject.push(arc)
  }

  // --- the colonnade --------------------------------------------------------
  for (const col of columns) {
    const ringCount = Math.max(4, Math.round(col.rings * Math.max(0.5, ctx.quality ** 0.5)))

    // A pier under each column: vertical mass without another forty verticals.
    // Tops are staggered — level tops draw a hard horizontal seam across the
    // whole composition and the piers stop reading as depth.
    const pierW = col.rMax * col.pierW
    const pierTop = col.spring + col.legLen * col.pierTop
    const pierFall = ctx.falloff(col.cx, pierTop)
    const pier =
      el('path', {
        d: `M${f(col.cx - pierW)} ${f(pierTop)}H${f(col.cx + pierW)}V${f(bottom)}H${f(col.cx - pierW)}Z`,
        fill: ctx.ramp(0.18 + 0.26 * pierFall),
        opacity: 0.52 + 0.16 * pierFall,
      }) +
      el('path', {
        d: `M${f(col.cx + pierW * Math.sign(light.dx || 1))} ${f(pierTop)}V${f(bottom)}`,
        stroke: withAlpha(ctx.ramp(0.92), 0.4),
        'stroke-width': u(1.8),
        fill: 'none',
      }) +
      el('path', {
        d: `M${f(col.cx - pierW)} ${f(pierTop)}H${f(col.cx + pierW)}`,
        stroke: withAlpha(ctx.ramp(0.8), 0.3),
        'stroke-width': u(2.4),
        fill: 'none',
      }) +
      // fluting, so the pier is a lit surface rather than a flat block
      Array.from({ length: 4 }, (_, i) => {
        const fx = col.cx - pierW + ((i + 1) * 2 * pierW) / 5
        return el('path', {
          d: `M${f(fx)} ${f(pierTop + u(6))}V${f(bottom)}`,
          stroke: withAlpha(ctx.ramp(0.72), 0.1 + 0.06 * i),
          'stroke-width': u(1.2),
          fill: 'none',
        })
      }).join('')
    ;(col === behindCol ? behind : back).push(pier)
    subject.push(pier)

    for (let k = 1; k <= ringCount; k++) {
      const t = k / ringCount
      const r = col.rMax * lerp(0.12, 1.02, t)
      const apexY = col.spring - r
      const fall = ctx.falloff(col.cx, apexY)
      const heavy = k % col.beat === 0
      const arc = arcPath(col.cx, col.spring, r)
      const legs = legsPath(col.cx, col.spring, r, col.legLen)

      const width = u((heavy ? 6.5 : 2.2) * weightK * (0.5 + 0.7 * fall))
      const tone = ctx.ramp(0.5 + 0.5 * fall)
      const off = u(3.2)

      // full density inside the focal form; skip rings the mask cannot reach
      const reaches =
        col.cx + r > focalLeft && col.cx - r < focalRight &&
        col.spring + col.legLen > focalTop && apexY < focalBottom
      if (reaches) {
        subject.push(
          el('path', { d: arc, fill: 'none', stroke: tone, 'stroke-width': width, opacity: 0.66 + 0.34 * fall }),
          el('path', {
            d: legs, fill: 'none', stroke: tone,
            'stroke-width': width * 0.55, opacity: 0.24 + 0.22 * fall,
          }),
          // misregistration: the outline that missed its fill
          el('path', {
            d: arc, fill: 'none',
            stroke: withAlpha(ctx.ramp(0.88), 0.28 + 0.24 * fall),
            'stroke-width': u(1.1),
            transform: `translate(${f(off * light.dx)} ${f(-off * light.dy)})`,
          }),
        )
      }

      // roughly a quarter density outside it, same field, quieter
      if (field.next() < 0.24 + 0.42 * fall) {
        const target = col === behindCol ? behind : back
        target.push(el('path', {
          d: arc, fill: 'none',
          stroke: ctx.ramp(0.36 + 0.42 * fall),
          'stroke-width': width * 0.75,
          opacity: 0.42 + 0.4 * fall,
        }))
        if (skel.bool(0.4)) {
          target.push(el('path', {
            d: legs, fill: 'none',
            stroke: ctx.ramp(0.3 + 0.3 * fall),
            'stroke-width': width * 0.4,
            opacity: 0.24 + 0.2 * fall,
          }))
        }
      }

      // one lit arch: the apex closest to the focal centre
      const score = Math.hypot(col.cx - focal.cx, apexY - focal.cy)
      if (score < accentScore && r > col.rMax * 0.58) {
        accentScore = score
        accent =
          el('path', {
            d: arc, fill: 'none', stroke: palette.accent,
            'stroke-width': u(7 * weightK), 'stroke-linecap': 'round',
          }) +
          el('path', {
            d: legs, fill: 'none', stroke: palette.accent,
            'stroke-width': u(4 * weightK), opacity: 0.75,
          }) +
          el('path', {
            d: arc, fill: 'none', stroke: withAlpha(palette.accent, 0.4),
            'stroke-width': u(2),
            transform: `translate(${f(u(8) * light.dx)} ${f(-u(8) * light.dy)})`,
          })
      }
    }

    // the nearest column's widest arch crosses over the mask edge
    if (col === frontCol) {
      front.push(
        el('path', {
          d: arcPath(col.cx, col.spring - u(10), col.rMax * 1.12),
          fill: 'none',
          stroke: ctx.ramp(0.95),
          'stroke-width': u(5 * weightK),
          opacity: 0.9,
        }),
        el('path', {
          d: legsPath(col.cx, col.spring - u(10), col.rMax * 1.12, col.legLen * 1.4),
          fill: 'none',
          stroke: ctx.ramp(0.95),
          'stroke-width': u(2.6 * weightK),
          opacity: 0.5,
        }),
      )
    }
  }

  const scene: Scene = { back, behind, subject, front }
  if (accent) scene.accent = accent
  return scene
}

export const nestedArches: Renderer = {
  id: 'nested-arches',
  name: 'Nested Arches',
  family: 'geometric',
  dark: true,
  palettes: ['basalt', 'graphite', 'ember', 'indigo', 'verdigris', 'bone', 'dune'],
  focals: ['arch', 'circle', 'ellipse', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
