import { lerp } from '../../svg'
import { path } from '../../scene/path'
import type { Path } from '../../scene/path'
import { node } from '../../scene/types'
import type { Node, SceneGraph } from '../../scene/types'
import type { ParamSchema, RenderContext, Renderer } from '../../types'

/**
 * Arches as masses.
 *
 * The first renderer on the scene graph. It emits nodes and says nothing about
 * strokes, fills, colour, shadows or blur — a node carries geometry, a depth
 * plane, a material and a tone, and every one of those consequences is decided
 * once by the pipeline instead of twenty-eight times by the renderers.
 *
 * What that removes from this file is worth naming: two gradient definitions,
 * an id namespace, a clip path, a cast-shadow offset, an edge stroke, an alpha
 * for the unclipped copy, and every call to `ctx.ramp`. What it adds is one
 * number per node. The composition is otherwise unchanged.
 *
 * Variety comes from structure rather than from parameters. A seed picks one
 * of five arrangements — row, nest, stack, mirror, scatter — and each puts the
 * arches somewhere genuinely different in the frame. Two seeds on the same
 * arrangement then differ in count, proportion, and which of four arch heads
 * is used, each set out from an explicit springing line so a squat segmental
 * arch and a tall pointed one come out of the same four numbers.
 *
 * One arch per composition is an aperture: emissive, cut open to light rather
 * than filled. It is what stops the frame being a pattern and gives it a
 * subject, and it is what the depth of field focuses on.
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
  plane: number
}

/**
 * The set-out of an arch, from which both its outline and its coursing follow.
 *
 * Everything is expressed from the springing line — the height at which the
 * head starts — because that is the line a real arch is set out from, and
 * keeping it explicit is what lets a squat segmental arch and a tall pointed
 * one come out of the same four numbers.
 */
function setOut(a: Arch) {
  const half = a.w / 2
  const springFrac = a.head === 'horseshoe' ? 0.52 : a.head === 'segmental' ? 0.76 : 0.62
  const spring = a.base - a.flip * a.h * springFrac
  const rise = a.h * (1 - springFrac)
  return {
    half,
    l: a.cx - half,
    r: a.cx + half,
    spring,
    rise,
    top: a.base - a.flip * a.h,
    /** head radii, as an ellipse centred on the springing line */
    hrx: a.head === 'segmental' ? half * 1.7 : half,
    hry: a.head === 'segmental' ? rise * 1.7 : rise,
  }
}

function archPath(a: Arch): Path {
  const s = setOut(a)
  const p = path().moveTo(s.l, a.base).lineTo(s.l, s.spring)

  switch (a.head) {
    case 'pointed':
      // two arcs meeting at an apex, which is the whole of gothic
      p.quadTo(s.l, s.spring - a.flip * s.rise * 0.72, a.cx, s.top)
      p.quadTo(s.r, s.spring - a.flip * s.rise * 0.72, s.r, s.spring)
      break
    case 'horseshoe':
      // the head is more than a semicircle, so it overhangs the jambs
      p.arcTo(s.half, s.rise, 0, true, a.flip > 0, s.r, s.spring)
      break
    default:
      p.arcTo(s.hrx, s.hry, 0, false, a.flip > 0, s.r, s.spring)
  }

  return p.lineTo(s.r, a.base).close().build()
}

/**
 * Half-width of the arch at a given height.
 *
 * Coursing needs to stop at the arch face. Trimming the lines analytically is
 * both cheaper and more honest than drawing them long and cutting them with a
 * clip path: there is no clip to define, no id to namespace, and the joints
 * land exactly on the outline instead of a hair inside it.
 */
function halfAt(a: Arch, y: number): number {
  const s = setOut(a)
  const above = (s.spring - y) * a.flip
  if (above <= 0) return s.half
  if (above >= s.rise) return 0
  if (a.head === 'pointed') return s.half * (1 - above / s.rise)
  const k = 1 - (above / s.hry) ** 2
  return k <= 0 ? 0 : Math.min(s.half * 1.02, s.hrx * Math.sqrt(k))
}

/** The same arch, stepped inward by `inset` on every side. */
function shrink(a: Arch, inset: number): Arch {
  return { ...a, w: Math.max(1, a.w - inset * 2), h: Math.max(1, a.h - inset) }
}

function build(ctx: RenderContext): SceneGraph {
  const skel = ctx.fork('skeleton')
  const { w, h, focal, baseline } = ctx
  const densityK = ctx.num('density')
  const proportionK = ctx.num('proportion')
  const nestingK = ctx.num('nesting')
  const shadowK = ctx.num('shadow')
  const coursesK = ctx.num('courses')
  const weightK = ctx.num('weight')
  const planChoice = ctx.str('plan')

  const nodes: Node[] = []
  const reach = Math.max(focal.rx, focal.ry)

  // --- the arrangement ------------------------------------------------------
  const PLANS = ['row', 'nest', 'stack', 'mirror', 'scatter'] as const
  const plan = PLANS.includes(planChoice as (typeof PLANS)[number])
    ? (planChoice as (typeof PLANS)[number])
    : skel.pick(PLANS)

  const HEADS: readonly Head[] = ['round', 'pointed', 'segmental', 'horseshoe']
  // one head shape for the whole composition; mixing them reads as indecision
  const head = skel.pick(HEADS)
  // squat through to tall, which is most of what tells two arcades apart
  const ratio = lerp(0.85, 2.4, proportionK) * skel.range(0.85, 1.15)

  const ground = Math.min(h * 0.95, baseline + reach * 0.15)
  const arches: Arch[] = []

  const push = (cx: number, base: number, wide: number, tone: number, flip = 1) => {
    arches.push({ cx, base, w: wide, h: wide * ratio, head, flip, tone, plane: 0.5 })
  }

  switch (plan) {
    case 'row': {
      // an arcade along one line, heights stepping so it is not a comb
      const n = Math.round(lerp(3, 8, densityK))
      const span = w * lerp(1.05, 1.45, densityK)
      const unit = span / n
      for (let i = 0; i < n; i++) {
        const cx = focal.cx - span / 2 + unit * (i + 0.5)
        push(cx, ground, unit * skel.range(0.78, 1.02), 0.32 + 0.5 * skel.next())
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
          cx: focal.cx, base: ground, w: wide, h: wide * ratio,
          head, flip: 1, tone: 0, plane: 0.5,
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

  /**
   * Depth, from one rule: a bigger arch is a nearer arch.
   *
   * This is the only place the renderer thinks about depth. Blur tier, shadow
   * softness, contact darkening, atmospheric falloff and grade weight are all
   * downstream of it, and none of them appear anywhere in this file.
   */
  const widest = arches.reduce((m, a) => Math.max(m, a.w), 1)
  for (const a of arches) a.plane = 0.16 + 0.66 * (a.w / widest) ** 0.8

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

  /**
   * The aperture is the subject, so it is near.
   *
   * Size alone would put it wherever its width fell, and on a nest that is the
   * smallest arch in the frame — which sends the depth of field to focus on
   * the far plane and blurs the one thing the composition is about. What the
   * viewer is looking at is a fact about the composition, not a consequence of
   * geometry, so the renderer states it.
   */
  const opening = arches[openIdx]
  if (opening) opening.plane = 0.88

  // --- the ground -----------------------------------------------------------
  nodes.push(node(
    {
      k: 'poly',
      pts: Float64Array.from([-w, ground, w * 2, ground, w * 2, h + reach, -w, h + reach]),
      closed: true,
    },
    0.03,
    { k: 'matte', edgeDark: 0 },
    0.16,
    { mask: 'outside', light: { receives: true, casts: false, emissive: 0 }, seedRef: 1 },
  ))

  // --- the arches -----------------------------------------------------------
  arches.forEach((a, i) => {
    if (ctx.expired()) return
    const open = i === openIdx
    const geom = { k: 'path' as const, path: archPath(a) }

    nodes.push(node(
      geom,
      a.plane,
      open ? { k: 'emissive', intensity: 0.45 } : { k: 'mass', facing: 0.5 + 0.5 * shadowK },
      open ? 0.82 : a.tone,
      {
        seedRef: i + 2,
        light: { receives: !open, casts: !open, emissive: open ? 1 : 0 },
      },
    ))

    // The nest: concentric arches stepped inside this one. The name of the
    // style, kept as a texture on the mass rather than as the whole image.
    if (nestingK > 0.05 && !open && a.w > reach * 0.3) {
      const rings = Math.round(lerp(2, 9, nestingK))
      for (let k = 1; k <= rings; k++) {
        const inner = shrink(a, (a.w * 0.42 * k) / rings)
        if (inner.w < 6) break
        nodes.push(node(
          { k: 'path', path: archPath(inner) },
          a.plane + 0.004,
          { k: 'ink', bleed: 0.3, pressure: 0.35 },
          a.tone > 0.5 ? 0.1 : 0.95,
          {
            weight: 1.4 * weightK, stroke: true, alpha: 0.5,
            seedRef: i * 32 + k,
            light: { receives: false, casts: false, emissive: 0 },
          },
        ))
      }
    }

    // Coursing: the horizontal joints of the stonework, trimmed to the arch
    // face rather than drawn long and clipped.
    if (coursesK > 0.05 && !open) {
      const courses = Math.round(lerp(3, 16, coursesK))
      for (let k = 1; k < courses; k++) {
        const y = a.base - a.flip * a.h * (k / courses)
        const hw = halfAt(a, y)
        if (hw < 1) continue
        nodes.push(node(
          { k: 'poly', pts: Float64Array.from([a.cx - hw, y, a.cx + hw, y]), closed: false },
          a.plane + 0.006,
          { k: 'ink', bleed: 0.5, pressure: 0.2 },
          a.tone > 0.55 ? 0.06 : 0.7,
          {
            weight: 1.1 * weightK, stroke: true, alpha: 0.34 + 0.3 * coursesK,
            seedRef: i * 64 + k,
            light: { receives: false, casts: false, emissive: 0 },
          },
        ))
      }
    }
  })

  // the datum the whole arrangement was set out from
  const springY = ground - (arches[0]?.h ?? reach) * 0.62
  nodes.push(node(
    { k: 'poly', pts: Float64Array.from([-w * 0.1, springY, w * 1.1, springY]), closed: false },
    0.97,
    { k: 'ink', bleed: 0.2, pressure: 0.15 },
    0.9,
    {
      weight: 1.2 * weightK, stroke: true, alpha: 0.5, seedRef: 7,
      light: { receives: false, casts: false, emissive: 0 },
    },
  ))

  return { nodes }
}

export const nestedArches: Renderer = {
  id: 'nested-arches',
  name: 'Nested Arches',
  family: 'geometric',
  dark: true,
  focals: ['arch', 'circle', 'ellipse', 'diamond'],
  sampler: 'field',
  schema,
  build,
}
