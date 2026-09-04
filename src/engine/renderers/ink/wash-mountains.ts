import { clamp, el, f, lerp, smooth } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Ridges in wash, receding into mist.
 *
 * Shan shui solves depth with one device and this renderer is that device:
 * each ridge is painted wet at its top edge and allowed to fade downward into
 * nothing, so the ridge behind shows through the bottom of the ridge in front.
 * The overlap is therefore not an occlusion — it is a translucency, and it is
 * why the form is legible without a single outline below the skyline.
 *
 * The tonal order is the whole illusion and it runs the other way from every
 * other landscape in the studio: the FAR ridge is the palest. Atmosphere puts
 * more air between you and a distant thing, so it loses contrast against the
 * sky. Getting that backwards produces a picture that is technically the same
 * shapes and reads as a flat pattern.
 *
 * The mist bands between ridges are the only pure invention here, and they are
 * the cheapest tool in the file: a pale horizontal wash laid across the foot of
 * a ridge severs it from the one below and buys a whole extra plane of depth.
 */

const schema: ParamSchema = [
  { key: 'ridges', label: 'Ridges', type: 'range', min: 2, max: 9, step: 1, default: 5 },
  { key: 'relief', label: 'Relief', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.55 },
  { key: 'wash', label: 'Wash depth', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.55 },
  { key: 'mist', label: 'Mist', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'trees', label: 'Trees', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'disc', 'circle', 'ellipse'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, palette, baseline, uid } = ctx
  const ridges = clamp(Math.round(ctx.num('ridges')), 2, 9)
  const reliefK = ctx.num('relief')
  const washK = ctx.num('wash')
  const mistK = ctx.num('mist')
  const treeK = ctx.num('trees')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const ink = ctx.ramp(1)
  const horizon = clamp(baseline, h * 0.42, h * 0.9)
  const rise = ctx.short * lerp(0.1, 0.4, reliefK)

  // --- the sun, behind everything -----------------------------------------
  const sunR = ctx.short * skel.range(0.07, 0.15)
  const sunX = w * skel.range(0.2, 0.8)
  const sunY = horizon - ctx.short * skel.range(0.3, 0.62)
  back.push(el('circle', {
    cx: sunX, cy: sunY, r: sunR,
    fill: withAlpha(mixHex(ink, palette.ground, 0.55), 0.3),
  }))

  for (let i = 0; i < ridges; i++) {
    if (ctx.expired()) break
    // 0 is the farthest and the palest
    const depth = ridges === 1 ? 1 : i / (ridges - 1)
    const baseY = horizon - (1 - depth) * ctx.short * lerp(0.12, 0.42, reliefK)
    const amp = rise * lerp(0.55, 1.35, depth)
    const wave = lerp(1250, 520, reliefK) * lerp(1.7, 0.85, depth)
    const phase = skel.range(0, 600)

    /**
     * Ridged noise, not folded noise.
     *
     * Taking the absolute value of the field gives peaks where it is large and
     * hard V-shaped valleys where it crosses zero, which is a saw blade.
     * Mountains are the other way up: sharp summits and broad soft valleys that
     * the weather has filled in. So the field is inverted first and then
     * squared — the square is what flattens the valley floors and leaves only
     * the summits sharp, and it costs one multiply.
     */
    const wobble = skel.range(0.8, 1.35)
    const steps = 52
    const crest: number[] = []
    for (let s = 0; s <= steps; s++) {
      const x = -w * 0.06 + (w * 1.12 * s) / steps
      const field = ctx.fbm((n(x) + phase) / wave, phase / 300, 3)
      const ridged = (1 - Math.min(1, Math.abs(field) * 1.1)) ** 1.4
      const detail = ctx.fbm((n(x) - phase) / (wave * 0.32), phase / 700, 2) * 0.16
      crest.push(x, baseY - Math.max(0, ridged * 0.95 + detail) * amp * 1.5 * wobble)
    }

    const tone = mixHex(ink, palette.ground, lerp(0.72, 0.05, depth))
    const gradId = `${uid}-w${i}`
    const fade = lerp(0.34, 0.85, washK)
    defs.push(el('linearGradient',
      {
        id: gradId, gradientUnits: 'userSpaceOnUse',
        x1: 0, y1: baseY - amp * 1.2, x2: 0, y2: baseY + ctx.short * fade,
      },
      el('stop', { offset: '0%', 'stop-color': tone, 'stop-opacity': lerp(0.5, 0.95, depth) }) +
      el('stop', { offset: '38%', 'stop-color': tone, 'stop-opacity': lerp(0.26, 0.55, depth) }) +
      el('stop', { offset: '100%', 'stop-color': tone, 'stop-opacity': 0 })))

    const body =
      `${smooth(crest, 0.5)}L${f(w * 1.06)} ${f(h + u(40))}L${f(-w * 0.06)} ${f(h + u(40))}Z`

    const ridge =
      el('path', { d: body, fill: `url(#${gradId})` }) +
      // the wet edge: where the brush was loaded, the skyline is dark and hard
      el('path', {
        d: smooth(crest, 0.5), fill: 'none',
        stroke: withAlpha(tone, lerp(0.35, 0.85, depth)),
        'stroke-width': u(lerp(1.2, 3.6, depth)),
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      })

    behind.push(ridge)
    subject.push(ridge)
    if (depth < 0.85) back.push(ridge)

    // --- mist along the foot ----------------------------------------------
    if (mistK > 0.03 && i < ridges - 1) {
      const my = baseY + amp * skel.range(0.1, 0.45)
      behind.push(el('rect', {
        x: -w * 0.06, y: my, width: w * 1.12, height: ctx.short * 0.05 * lerp(0.6, 1.6, mistK),
        fill: withAlpha(palette.ground, 0.35 + 0.4 * mistK),
      }))
    }

    // --- trees, on the nearest ridge only ---------------------------------
    if (treeK > 0.03 && depth > 0.82) {
      const trees = Math.round(lerp(3, 22, treeK))
      for (let t = 0; t < trees; t++) {
        const idx = skel.int(2, steps - 2) * 2
        const tx = (crest[idx] as number) + skel.range(-1, 1) * u(10)
        const ty = crest[idx + 1] as number
        const th = ctx.short * skel.range(0.012, 0.045)
        subject.push(el('path', {
          d: `M${f(tx)} ${f(ty)}V${f(ty - th)}` +
             `M${f(tx - th * 0.32)} ${f(ty - th * 0.6)}L${f(tx)} ${f(ty - th)}` +
             `L${f(tx + th * 0.32)} ${f(ty - th * 0.6)}`,
          stroke: withAlpha(tone, 0.8), 'stroke-width': u(skel.range(1, 2.4)),
          'stroke-linecap': 'round', fill: 'none',
        }))
      }
    }
  }

  // A near branch entering from an edge, crossing the form. The one thing in
  // the frame that is close, which is what tells you the rest is not.
  const fromLeft = skel.bool()
  const bx = fromLeft ? -u(30) : w + u(30)
  const by = h * skel.range(0.08, 0.4)
  const branch: number[] = []
  for (let i = 0; i <= 14; i++) {
    const t = i / 14
    branch.push(
      bx + (fromLeft ? 1 : -1) * t * w * skel.range(0.3, 0.55),
      by + Math.sin(t * 2.4) * ctx.short * 0.08 + t * ctx.short * 0.1,
    )
  }
  front.push(el('path', {
    d: smooth(branch, 0.5), fill: 'none', stroke: withAlpha(ink, 0.8),
    'stroke-width': u(4.5), 'stroke-linecap': 'round',
  }))
  for (let i = 2; i < branch.length; i += 4) {
    const lx = branch[i] as number
    const ly = branch[i + 1] as number
    front.push(el('path', {
      d: `M${f(lx)} ${f(ly)}l${f(u(skel.range(-26, 26)))} ${f(u(skel.range(-30, -12)))}`,
      stroke: withAlpha(ink, 0.7), 'stroke-width': u(2.2), 'stroke-linecap': 'round', fill: 'none',
    }))
  }

  // --- the accent: the sun, given its colour ------------------------------
  const accent =
    el('circle', { cx: sunX, cy: sunY, r: sunR, fill: withAlpha(palette.accent, 0.55) }) +
    el('circle', {
      cx: sunX, cy: sunY, r: sunR, fill: 'none',
      stroke: palette.accent, 'stroke-width': u(2.6),
    })

  return { back, behind, subject, front, defs, accent }
}

export const washMountains: Renderer = {
  id: 'wash-mountains',
  name: 'Wash Mountains',
  family: 'ink',
  dark: false,
  focals: ['disc', 'circle', 'ellipse'],
  sampler: 'field',
  schema,
  render,
}
