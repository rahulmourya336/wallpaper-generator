/**
 * TEMPORARY. The pre-migration renderer, kept unregistered so the same seed
 * can be composed through both paths for the step-2 comparison. Deleted when
 * the last family is ported and the shim goes.
 */
import { el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Arches as masses.
 *
 * The previous version drew one thing: a fan of concentric hairline arcs
 * springing from a horizontal line, centred on the subject. Every seed came
 * out as that same picture in a different colour, which for the default style
 * is the worst place in the catalogue for it to happen. It also sat on top of
 * Moire Interference, which already owns dense concentric hairlines and does
 * them better.
 *
 * So arches here are solid forms. Weight is the thing this family was missing:
 * a mass has a silhouette, an edge, and a shadow, and none of those are
 * available to a line.
 *
 * Variety comes from structure rather than from parameters. A seed picks one
 * of five arrangements — a row, a nest, a stack, a mirrored pair, a scatter —
 * and each arrangement puts the arches somewhere genuinely different in the
 * frame. Two seeds on the same arrangement then differ in count, proportion
 * and the shape of the arch head, of which there are four. That is a real
 * space of compositions, where the old one had a single point in it.
 *
 * One arch in every composition is an aperture: cut open to a lit sky rather
 * than filled. It is what stops the frame being a pattern and gives it a
 * subject to look at.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Arch count', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.5 },
  { key: 'proportion', label: 'Proportion', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'nesting', label: 'Nesting', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'shadow', label: 'Shadow', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'courses', label: 'Coursing', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'plan', label: 'Arrangement', type: 'select', options: ['auto', 'row', 'nest', 'stack', 'mirror', 'scatter'], default: 'auto' },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'arch', 'circle', 'diamond', 'ellipse'], default: 'auto' },
]

type Head = 'round' | 'pointed' | 'segmental' | 'horseshoe'
type Arch = {
  cx: number
  base: number
  w: number
  h: number
  head: Head
  /** 1 upright, -1 standing on its head */
  flip: number
  tone: number
}

/**
 * An arch as a closed path: two jambs and a head.
 *
 * Everything is expressed from the springing line — the height at which the
 * head starts — because that is the line a real arch is set out from, and
 * keeping it explicit is what lets a squat segmental arch and a tall pointed
 * one come out of the same four numbers.
 */
function archPath(a: Arch): string {
  const half = a.w / 2
  const l = a.cx - half
  const r = a.cx + half
  const y = a.base
  const flip = a.flip

  // where the head springs from, and how far it rises above that
  // A segmental head has to keep enough rise to still be an arch. At the
  // shallow end it stops reading as one and the composition turns into a set
  // of overlapping rectangles.
  const springFrac = a.head === 'horseshoe' ? 0.52 : a.head === 'segmental' ? 0.76 : 0.62
  const spring = y - flip * a.h * springFrac
  const rise = a.h * (1 - springFrac)
  const top = y - flip * a.h

  let head: string
  switch (a.head) {
    case 'pointed':
      // two arcs meeting at an apex, which is the whole of gothic
      head =
        `Q${f(l)} ${f(spring - flip * rise * 0.72)} ${f(a.cx)} ${f(top)}` +
        `Q${f(r)} ${f(spring - flip * rise * 0.72)} ${f(r)} ${f(spring)}`
      break
    case 'horseshoe':
      // the head is more than a semicircle, so it overhangs the jambs
      head =
        `A${f(half * 1.0)} ${f(rise)} 0 1 ${flip > 0 ? 1 : 0} ${f(r)} ${f(spring)}`
      break
    case 'segmental':
      // a shallow slice of a much larger circle
      head = `A${f(half * 1.7)} ${f(rise * 1.7)} 0 0 ${flip > 0 ? 1 : 0} ${f(r)} ${f(spring)}`
      break
    default:
      head = `A${f(half)} ${f(rise)} 0 0 ${flip > 0 ? 1 : 0} ${f(r)} ${f(spring)}`
  }

  return `M${f(l)} ${f(y)}L${f(l)} ${f(spring)}${head}L${f(r)} ${f(y)}Z`
}

/** The same arch, stepped inward by `inset` on every side. */
function shrink(a: Arch, inset: number): Arch {
  return {
    ...a,
    w: Math.max(1, a.w - inset * 2),
    h: Math.max(1, a.h - inset),
  }
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, focal, palette, light, baseline, uid } = ctx
  const densityK = ctx.num('density')
  const proportionK = ctx.num('proportion')
  const nestingK = ctx.num('nesting')
  const shadowK = ctx.num('shadow')
  const coursesK = ctx.num('courses')
  const weightK = ctx.num('weight')
  const planChoice = ctx.str('plan')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const reach = Math.max(focal.rx, focal.ry)

  // --- defs -----------------------------------------------------------------
  defs.push(
    // the sky behind the open arch, brightest toward the light
    el('linearGradient',
      {
        id: `${uid}-sky`, gradientUnits: 'userSpaceOnUse',
        x1: focal.cx - light.dx * reach, y1: focal.cy + reach,
        x2: focal.cx + light.dx * reach, y2: focal.cy - reach,
      },
      el('stop', { offset: '0%', 'stop-color': mixHex(ctx.ramp(0.3), palette.ground, 0.3) }) +
      el('stop', { offset: '58%', 'stop-color': ctx.ramp(0.72) }) +
      el('stop', { offset: '100%', 'stop-color': ctx.ramp(1) })),

    // stone: lighter at the head, falling off toward the base
    el('linearGradient',
      { id: `${uid}-face`, gradientUnits: 'objectBoundingBox', x1: '0%', y1: '0%', x2: '0%', y2: '100%' },
      el('stop', { offset: '0%', 'stop-color': withAlpha(ctx.ramp(1), 0.22) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(palette.ink, 0.28) })),
  )

  // --- the arrangement ------------------------------------------------------
  const PLANS = ['row', 'nest', 'stack', 'mirror', 'scatter'] as const
  const plan = PLANS.includes(planChoice as (typeof PLANS)[number])
    ? (planChoice as (typeof PLANS)[number])
    : (skel.pick(PLANS) as (typeof PLANS)[number])

  const HEADS: readonly Head[] = ['round', 'pointed', 'segmental', 'horseshoe']
  // one head shape for the whole composition; mixing them reads as indecision
  const head = skel.pick(HEADS)
  // squat through to tall, which is most of what tells two arcades apart
  const ratio = lerp(0.85, 2.4, proportionK) * skel.range(0.85, 1.15)

  const ground = Math.min(h * 0.95, baseline + reach * 0.15)
  const arches: Arch[] = []

  const push = (cx: number, base: number, wide: number, tone: number, flip = 1) => {
    arches.push({ cx, base, w: wide, h: wide * ratio, head, flip, tone })
  }

  switch (plan) {
    case 'row': {
      // an arcade along one line, heights stepping so it is not a comb
      const n = Math.round(lerp(3, 8, densityK))
      const span = w * lerp(1.05, 1.45, densityK)
      const unit = span / n
      for (let i = 0; i < n; i++) {
        const cx = focal.cx - span / 2 + unit * (i + 0.5)
        const wide = unit * skel.range(0.78, 1.02)
        push(cx, ground, wide, 0.32 + 0.5 * skel.next())
      }
      break
    }
    case 'nest': {
      // the name of the style, done as mass: one arch stepped in on itself
      const n = Math.round(lerp(3, 9, densityK))
      const wide = reach * lerp(1.5, 2.4, proportionK)
      for (let i = 0; i < n; i++) {
        const t = i / n
        const a: Arch = {
          cx: focal.cx, base: ground, w: wide, h: wide * ratio, head, flip: 1, tone: 0,
        }
        const stepped = shrink(a, wide * 0.5 * t * lerp(0.5, 0.95, nestingK))
        stepped.tone = lerp(0.28, 0.92, t)
        arches.push(stepped)
      }
      break
    }
    case 'stack': {
      // shrinking and climbing, each sitting on the head of the last
      const n = Math.round(lerp(3, 7, densityK))
      let wide = reach * lerp(1.6, 2.6, proportionK)
      let base = ground
      for (let i = 0; i < n; i++) {
        push(focal.cx + skel.gauss() * reach * 0.18, base, wide, lerp(0.88, 0.3, i / n))
        base -= wide * ratio * lerp(0.55, 0.85, nestingK)
        wide *= lerp(0.78, 0.92, nestingK)
      }
      break
    }
    case 'mirror': {
      // an arch and its inverted twin, meeting at the springing line
      const n = Math.round(lerp(2, 5, densityK))
      const span = w * 1.1
      const unit = span / n
      const meet = focal.cy + reach * 0.2
      for (let i = 0; i < n; i++) {
        const cx = focal.cx - span / 2 + unit * (i + 0.5)
        const wide = unit * skel.range(0.8, 1.0)
        push(cx, meet, wide, 0.38 + 0.45 * skel.next(), 1)
        push(cx, meet, wide, 0.26 + 0.35 * skel.next(), -1)
      }
      break
    }
    default: {
      // scattered at several scales, some standing on their heads
      const n = Math.round(lerp(4, 11, densityK))
      for (let i = 0; i < n; i++) {
        const a = skel.range(0, Math.PI * 2)
        const d = reach * skel.range(0.08, 1.25)
        const wide = reach * lerp(0.4, 1.5, skel.next() ** 1.6)
        push(
          focal.cx + Math.cos(a) * d,
          focal.cy + Math.sin(a) * d * 0.8 + wide * ratio * 0.5,
          wide,
          0.3 + 0.6 * skel.next(),
          skel.bool(0.15) ? -1 : 1,
        )
      }
    }
  }

  // --- the aperture ---------------------------------------------------------
  // Whichever arch is nearest the subject is cut open instead of filled. On a
  // nest it is the innermost, which is the one the stepping already leads to.
  let openIdx = 0
  if (plan === 'nest') {
    openIdx = arches.length - 1
  } else {
    let best = Infinity
    arches.forEach((a, i) => {
      const d = Math.hypot(a.cx - focal.cx, a.base - a.h * 0.5 * a.flip - focal.cy)
      if (d < best) { best = d; openIdx = i }
    })
  }

  // --- drawing --------------------------------------------------------------
  const throwLen = u(lerp(4, 40, shadowK))
  let accent: string | undefined

  arches.forEach((a, i) => {
    if (ctx.expired()) return
    const d = archPath(a)
    const open = i === openIdx
    const parts: string[] = []

    // the shadow the mass drops behind itself, all agreeing on one source
    if (shadowK > 0.02 && !open) {
      parts.push(el('path', {
        d, fill: withAlpha(palette.ink, 0.3 + 0.25 * shadowK),
        transform: `translate(${f(-light.dx * throwLen)} ${f(throwLen * 0.55)})`,
      }))
    }

    if (open) {
      // sky through the opening, and a bright reveal round its edge
      parts.push(
        el('path', { d, fill: `url(#${uid}-sky)` }),
        el('path', {
          d, fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.55),
          'stroke-width': u(2.6 * weightK),
        }),
      )
    } else {
      parts.push(
        el('path', { d, fill: ctx.ramp(a.tone) }),
        // the face, so the mass is not a flat silhouette
        el('path', { d, fill: `url(#${uid}-face)` }),
        // and an edge. Masses overlap in four of the five arrangements, and
        // without a defined edge the overlaps read as washes of translucent
        // colour rather than as one form passing in front of another.
        el('path', {
          d, fill: 'none',
          stroke: withAlpha(a.tone > 0.55 ? palette.ink : ctx.ramp(1), 0.3),
          'stroke-width': u(1.6 * weightK),
        }),
      )
    }

    // The nest: concentric arches stepped inside this one. This is the name of
    // the style, kept as a texture on the mass rather than as the whole image.
    if (nestingK > 0.05 && !open && a.w > reach * 0.3) {
      const rings = Math.round(lerp(2, 9, nestingK))
      for (let k = 1; k <= rings; k++) {
        const inner = shrink(a, (a.w * 0.42 * k) / rings)
        if (inner.w < u(6)) break
        parts.push(el('path', {
          d: archPath(inner), fill: 'none',
          stroke: withAlpha(ctx.ramp(a.tone > 0.5 ? 0.1 : 0.95), 0.16 + 0.2 * nestingK),
          'stroke-width': u(1.4 * weightK),
        }))
      }
    }

    // Coursing: the horizontal joints of the stonework, cut to the arch so the
    // lines stop at the head instead of running out into the sky. A real
    // clipPath rather than the CSS path() shape function: the export
    // rasterises the document through an <img>, and only the SVG element is
    // certain to be honoured on every road to a bitmap.
    if (coursesK > 0.05 && !open) {
      const courses = Math.round(lerp(3, 16, coursesK))
      const lines: string[] = []
      for (let k = 1; k < courses; k++) {
        const y = a.base - a.flip * a.h * (k / courses)
        lines.push(`M${f(a.cx - a.w / 2)} ${f(y)}H${f(a.cx + a.w / 2)}`)
      }
      defs.push(el('clipPath',
        { id: `${uid}-arch${i}`, clipPathUnits: 'userSpaceOnUse' },
        el('path', { d })))
      parts.push(el('path', {
        d: lines.join(''), fill: 'none',
        stroke: withAlpha(palette.ink, 0.16 + 0.2 * coursesK),
        'stroke-width': u(1.1 * weightK),
        'clip-path': `url(#${uid}-arch${i})`,
      }))
    }

    const group = parts.join('')
    subject.push(group)
    // The arcade runs past the focal form; drawn only into `subject` the
    // arches outside it disappear and the frame empties out.
    behind.push(el('g', { opacity: 0.45 }, group))

    if (open) {
      accent =
        el('path', {
          d, fill: 'none', stroke: palette.accent, 'stroke-width': u(4 * weightK),
        }) +
        el('path', {
          d: archPath(shrink(a, a.w * 0.09)), fill: 'none',
          stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.6 * weightK),
        })
    }
  })

  // --- the ground -----------------------------------------------------------
  back.push(el('path', {
    d: `M${f(-w)} ${f(ground)}H${f(w * 2)}V${f(h + reach)}H${f(-w)}Z`,
    fill: withAlpha(mixHex(palette.ground, ctx.ramp(0.35), 0.45), 0.7),
  }))
  back.push(el('path', {
    d: `M${f(-w)} ${f(ground)}H${f(w * 2)}`,
    stroke: withAlpha(ctx.ramp(0.6), 0.4), 'stroke-width': u(1.6 * weightK), fill: 'none',
  }))

  // one long line running across the frame at the springing height, which is
  // the datum the whole arrangement was set out from
  const springY = ground - (arches[0]?.h ?? reach) * 0.62
  front.push(el('path', {
    d: `M${f(-w * 0.1)} ${f(springY)}H${f(w * 1.1)}`,
    stroke: withAlpha(ctx.ramp(1), 0.28), 'stroke-width': u(1.2 * weightK), fill: 'none',
  }))

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const legacyNestedArches: Renderer = {
  // the same id on purpose: the compositor salts its RNG with it, so the
  // comparison is only honest if both paths get the same streams
  id: 'nested-arches',
  name: 'Nested Arches (pre-migration)',
  family: 'geometric',
  dark: true,
  focals: ['arch', 'circle', 'ellipse', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
