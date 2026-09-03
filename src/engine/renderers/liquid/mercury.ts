import { circlePath, el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Coalescing metal.
 *
 * Blobs that merge where they touch, the way mercury does. The merge is the
 * classic gooey filter: blur the group so neighbouring edges bleed into one
 * another, then run the alpha through a steep contrast curve so the bleed
 * snaps back to a hard edge. What survives is a single silhouette with proper
 * necks between the drops, which no amount of overlapping circles gives you.
 *
 * The filter runs on the group, so its cost is one region for the whole
 * family rather than one per blob, and it stays affordable at export size.
 *
 * Each drop is then lit as a sphere: a wide diagonal body gradient, a specular
 * cap high on the light side, and a thin bounce along the opposite rim, which
 * is what separates liquid metal from a flat circle.
 */

const schema: ParamSchema = [
  { key: 'count', label: 'Drops', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.5 },
  { key: 'merge', label: 'Surface tension', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'spread', label: 'Spread', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'specular', label: 'Specular', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'satellites', label: 'Satellites', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'disc'], default: 'auto' },
]

type Drop = { x: number; y: number; r: number }

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette, light, uid } = ctx
  const countK = ctx.num('count')
  const mergeK = ctx.num('merge')
  const spreadK = ctx.num('spread')
  const specK = ctx.num('specular')
  const satK = ctx.num('satellites')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const reach = Math.max(focal.rx, focal.ry)

  // The pool: a few large drops packed close enough to neck together, laid out
  // along a wandering spine so the mass reads as one poured body rather than a
  // ring of circles.
  const bodies = Math.round(lerp(3, 8, countK))
  const spineAngle = skel.range(0, Math.PI * 2)
  const spineBend = skel.range(-0.9, 0.9)
  const drops: Drop[] = []

  for (let i = 0; i < bodies; i++) {
    const t = bodies === 1 ? 0.5 : i / (bodies - 1)
    const a = spineAngle + spineBend * (t - 0.5) * 2
    const along = (t - 0.5) * 2 * reach * lerp(0.55, 1.35, spreadK)
    const jitter = reach * 0.22
    drops.push({
      x: focal.cx + Math.cos(a) * along + skel.gauss() * jitter,
      y: focal.cy + Math.sin(a) * along + skel.gauss() * jitter,
      r: reach * lerp(0.3, 0.62, skel.next()) * lerp(1.05, 0.72, spreadK),
    })
  }

  // Satellites: small beads flung off the mass. They keep their own edge
  // because they sit outside the blur's reach, which is what makes the necked
  // ones read as necked.
  const beads = Math.round(lerp(0, 14, satK) * Math.max(0.5, ctx.quality ** 0.4))
  const loose: Drop[] = []
  for (let i = 0; i < beads; i++) {
    const a = skel.range(0, Math.PI * 2)
    const d = reach * skel.range(0.9, 2.1)
    loose.push({
      x: focal.cx + Math.cos(a) * d,
      y: focal.cy + Math.sin(a) * d * 0.8,
      r: reach * skel.range(0.02, 0.075),
    })
  }

  // --- the gooey merge -----------------------------------------------------
  // stdDeviation sets how far apart two drops can be and still fuse; the
  // matrix then rescales alpha steeply about a threshold to restore the edge.
  const goo = u(lerp(4, 26, mergeK))
  defs.push(
    el('filter',
      {
        id: `${uid}-goo`, x: '-20%', y: '-20%', width: '140%', height: '140%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: goo, result: 'b' }) +
      el('feColorMatrix', {
        in: 'b',
        type: 'matrix',
        values: `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${f(lerp(9, 20, mergeK))} -${f(lerp(4, 9, mergeK))}`,
      })),
  )

  // Body shading. The gradient runs along the light direction so every drop in
  // the composition is lit from the same side as the rest of the picture.
  const gx = -light.dx
  const gy = light.dy
  defs.push(
    el('linearGradient',
      {
        id: `${uid}-body`, gradientUnits: 'objectBoundingBox',
        x1: f(0.5 - gx * 0.5), y1: f(0.5 - gy * 0.5),
        x2: f(0.5 + gx * 0.5), y2: f(0.5 + gy * 0.5),
      },
      el('stop', { offset: '0%', 'stop-color': ctx.ramp(0.94) }) +
      el('stop', { offset: '46%', 'stop-color': ctx.ramp(0.6) }) +
      el('stop', { offset: '100%', 'stop-color': mixHex(ctx.ramp(0.22), palette.ink, 0.35) })),
  )

  // The specular cap: a small bright ellipse high on the lit side, soft edged.
  defs.push(
    el('radialGradient',
      { id: `${uid}-spec`, gradientUnits: 'objectBoundingBox', cx: '50%', cy: '50%', r: '50%' },
      el('stop', { offset: '0%', 'stop-color': withAlpha(palette.ramp[palette.ramp.length - 1] as string, 0.9 * specK) }) +
      el('stop', { offset: '55%', 'stop-color': withAlpha(palette.ramp[palette.ramp.length - 1] as string, 0.28 * specK) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(palette.ramp[palette.ramp.length - 1] as string, 0) })),
  )

  // --- the merged silhouette ----------------------------------------------
  const mass = drops.map((d) => el('circle', { cx: d.x, cy: d.y, r: d.r })).join('')
  const beadMass = loose.map((d) => el('circle', { cx: d.x, cy: d.y, r: d.r })).join('')

  subject.push(
    el('g', { filter: `url(#${uid}-goo)`, fill: `url(#${uid}-body)` }, mass),
    el('g', { fill: `url(#${uid}-body)`, opacity: 0.85 }, beadMass),
  )

  // A soft dark seat under the mass, so it sits on the ground rather than
  // floating on it. It gets its own plain blur rather than the goo: the goo's
  // whole job is to restore a hard edge, and a shadow with a hard edge is a
  // black crescent, not a shadow.
  defs.push(
    el('filter',
      {
        id: `${uid}-seat`, x: '-40%', y: '-40%', width: '180%', height: '180%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(26) })),
  )
  behind.push(
    el('g', { filter: `url(#${uid}-seat)`, fill: withAlpha(palette.ink, 0.28) },
      drops
        .map((d) => el('circle', {
          cx: d.x + u(7) * light.dx, cy: d.y + u(11), r: d.r * 0.92,
        }))
        .join('')),
  )

  // --- per-drop light ------------------------------------------------------
  // These sit above the merged silhouette, so each drop keeps its own
  // curvature even where the necks have fused two of them into one shape.
  let accent: string | undefined
  let bestScore = Infinity

  for (const d of [...drops, ...loose]) {
    const specR = d.r * lerp(0.36, 0.22, d.r / reach)
    const sx = d.x - light.dx * d.r * 0.46
    const sy = d.y - light.dy * d.r * 0.46

    subject.push(el('ellipse', {
      cx: sx, cy: sy, rx: specR * 1.25, ry: specR * 0.85,
      fill: `url(#${uid}-spec)`,
      transform: `rotate(${f((Math.atan2(light.dy, light.dx) * 180) / Math.PI)} ${f(sx)} ${f(sy)})`,
    }))

    // bounce light along the shaded rim: thin, and never as bright as the cap
    subject.push(el('path', {
      d: circlePath(d.x, d.y, d.r * 0.97),
      fill: 'none',
      stroke: withAlpha(ctx.ramp(0.85), 0.32 + 0.3 * specK),
      'stroke-width': u(lerp(1, 2.6, d.r / reach)),
      'stroke-dasharray': `${f(d.r * 1.5)} ${f(d.r * 4.2)}`,
      'stroke-dashoffset': f(d.r * (2.4 + light.angle)),
      'stroke-linecap': 'round',
    }))

    const score = Math.hypot(d.x - focal.cx, d.y - focal.cy) - d.r
    if (score < bestScore) {
      bestScore = score
      accent =
        el('ellipse', {
          cx: sx, cy: sy, rx: specR * 0.62, ry: specR * 0.44,
          fill: palette.accent,
          transform: `rotate(${f((Math.atan2(light.dy, light.dx) * 180) / Math.PI)} ${f(sx)} ${f(sy)})`,
        }) +
        el('path', {
          d: circlePath(d.x, d.y, d.r * 1.02),
          fill: 'none', stroke: withAlpha(palette.accent, 0.5), 'stroke-width': u(2.2),
          'stroke-dasharray': `${f(d.r * 0.9)} ${f(d.r * 5.4)}`,
          'stroke-linecap': 'round',
        })
    }
  }

  // --- the ground the metal is spilled on ---------------------------------
  // Wide flat rings, well outside the mass, reading as the disturbance the
  // pour left behind.
  const rings = Math.round(lerp(3, 9, spreadK))
  for (let i = 0; i < rings; i++) {
    const t = (i + 1) / rings
    const rr = reach * lerp(1.15, 3.4, t)
    back.push(el('ellipse', {
      cx: focal.cx, cy: focal.cy, rx: rr, ry: rr * lerp(0.86, 0.62, t),
      fill: 'none',
      stroke: withAlpha(ctx.ramp(0.45), 0.3 * (1 - t * 0.7)),
      'stroke-width': u(lerp(3.5, 1, t)),
    }))
  }

  // one drop breaking the form edge, so the mass is not politely contained
  const escape = skel.pick(drops)
  const ea = skel.range(0, Math.PI * 2)
  front.push(el('circle', {
    cx: escape.x + Math.cos(ea) * reach * 1.05,
    cy: escape.y + Math.sin(ea) * reach * 0.9,
    r: reach * skel.range(0.09, 0.17),
    fill: `url(#${uid}-body)`,
  }))

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const mercury: Renderer = {
  id: 'mercury',
  name: 'Mercury',
  family: 'liquid',
  dark: true,
  focals: ['circle', 'ellipse', 'disc'],
  sampler: 'field',
  schema,
  render,
}
