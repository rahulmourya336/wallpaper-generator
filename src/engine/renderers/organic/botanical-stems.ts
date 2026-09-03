import { el, f, lerp, smooth } from '../../svg'
import { mixHex, toward, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Stems rising from below the bottom edge, each carrying paired leaves and a
 * seed head. Every stem is rooted off-canvas so nothing floats, and leaf size,
 * stem height and node count all decay away from the focal centre.
 *
 * The interesting problem is depth. Layering alone gives none: three hundred
 * flat leaves at the same crispness read as a printed pattern no matter how
 * they overlap. Two things fix it, and they are the two a photographer would
 * reach for.
 *
 * Depth of field. Stems are sorted into three planes, and the far plane is
 * blurred and pushed toward the ground colour while the near plane is blurred
 * the other way and drawn oversized across the frame. The blur is per-plane,
 * one filter region each, so it costs three regions no matter how many stems
 * are in them.
 *
 * And the leaves are lit. A leaf is a curved surface with a rib down the
 * middle, so each half takes a different value, and the rib is the join. A
 * single flat fill throws all of that away.
 */

const schema: ParamSchema = [
  { key: 'density', label: 'Density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.58 },
  { key: 'turbulence', label: 'Sway', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'leaf', label: 'Leaf size', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'depth', label: 'Depth of field', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'pollen', label: 'Pollen', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'weight', label: 'Line weight', type: 'range', min: 0.4, max: 2.5, step: 0.05, default: 1 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'arch', 'circle', 'ellipse'], default: 'auto' },
]

/** Half a leaf: the spine out to the tip, bowed to one side. */
function leafHalf(
  x: number, y: number, len: number, wide: number, angle: number, side: number,
): string {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const px = -dy * wide * side
  const py = dx * wide * side
  return (
    `M${f(x)} ${f(y)}` +
    `Q${f(x + dx * len * 0.42 + px)} ${f(y + dy * len * 0.42 + py)} ` +
    `${f(x + dx * len)} ${f(y + dy * len)}` +
    `L${f(x)} ${f(y)}Z`
  )
}

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, focal, palette, light, uid } = ctx
  const densityK = ctx.num('density')
  const sway = ctx.num('turbulence')
  const leafK = ctx.num('leaf')
  const depthK = ctx.num('depth')
  const pollenK = ctx.num('pollen')
  const weightK = ctx.num('weight')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  // --- defs ----------------------------------------------------------------
  defs.push(
    // Two planes of blur, applied to a group each. A filter on a group costs
    // one region, so the cost is fixed however many stems land in the plane.
    el('filter',
      {
        id: `${uid}-far`, x: '-8%', y: '-8%', width: '116%', height: '116%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(lerp(0.4, 9, depthK)) })),
    el('filter',
      {
        id: `${uid}-near`, x: '-12%', y: '-12%', width: '124%', height: '124%',
        'color-interpolation-filters': 'sRGB',
      },
      el('feGaussianBlur', { stdDeviation: u(lerp(0.6, 12, depthK)) })),

    // A leaf is two halves meeting at the rib, so the lit half and the shaded
    // half are separate fills and the rib is where they meet.
    el('linearGradient',
      {
        id: `${uid}-lit`, gradientUnits: 'objectBoundingBox',
        x1: '0%', y1: '100%', x2: '0%', y2: '0%',
      },
      el('stop', { offset: '0%', 'stop-color': ctx.ramp(0.34) }) +
      el('stop', { offset: '100%', 'stop-color': ctx.ramp(0.86) })),
    el('linearGradient',
      {
        id: `${uid}-shade`, gradientUnits: 'objectBoundingBox',
        x1: '0%', y1: '100%', x2: '0%', y2: '0%',
      },
      el('stop', { offset: '0%', 'stop-color': mixHex(ctx.ramp(0.12), palette.ink, 0.4) }) +
      el('stop', { offset: '100%', 'stop-color': ctx.ramp(0.5) })),

    // the seed head, lit as a small sphere
    el('radialGradient',
      { id: `${uid}-head`, gradientUnits: 'objectBoundingBox', cx: '34%', cy: '30%', r: '78%' },
      el('stop', { offset: '0%', 'stop-color': ctx.ramp(0.95) }) +
      el('stop', { offset: '52%', 'stop-color': ctx.ramp(0.5) }) +
      el('stop', { offset: '100%', 'stop-color': mixHex(ctx.ramp(0.18), palette.ink, 0.5) })),
  )

  const stems = Math.round(lerp(14, 54, densityK) * Math.max(0.5, ctx.quality ** 0.5))

  // three planes, drawn far to near
  const farPlane: string[] = []
  const midPlane: string[] = []
  const nearPlane: string[] = []

  let accent: string | undefined
  let accentScore = Infinity

  for (let i = 0; i < stems; i++) {
    if ((i & 7) === 0 && ctx.expired()) break
    const rootX = lerp(-w * 0.05, w * 1.05, (i + skel.range(0.1, 0.9)) / stems)
    const rootY = ctx.baseline + u(skel.range(6, 60))
    const probeY = ctx.baseline * 0.78
    const fall = ctx.falloff(rootX, probeY)
    const dens = ctx.density(rootX, probeY)

    // Which plane a stem sits in. Drawn from a stream that does not vary with
    // quality, so the thumbnail sorts them the same way the export does.
    const plane = skel.next()
    const isFar = plane < 0.34
    const isNear = plane > 0.88
    const depthScale = isFar ? 0.66 : isNear ? 1.55 : 1

    const height = ctx.short * lerp(0.28, 1.15, fall) * skel.range(0.7, 1.25) * depthScale
    const segs = Math.max(5, Math.round(12 * (0.5 + 0.5 * fall)))
    const lean = ctx.fbm(n(rootX) * 0.004, 61, 3) * sway

    const pts: number[] = []
    for (let s = 0; s <= segs; s++) {
      const t = s / segs
      const y = rootY - height * t
      const bend = Math.sin(t * 2.1 + lean * 3) * ctx.short * 0.05 * sway
      const drift = ctx.fbm(n(rootX) * 0.004 + t * 0.9, 61, 3) * ctx.short * 0.05 * sway
      pts.push(rootX + bend + drift + lean * ctx.short * 0.06 * t, y)
    }
    const stemPath = smooth(pts, 0.5)
    const stemWidth = u(lerp(0.9, 3.6, fall) * weightK) * depthScale
    const tone = ctx.ramp(0.34 + 0.56 * fall)

    const parts: string[] = [
      // the stem, with its own shaded side
      el('path', {
        d: stemPath, fill: 'none', stroke: mixHex(tone, palette.ink, 0.45),
        'stroke-width': stemWidth * 1.7, opacity: 0.4 + 0.4 * fall, 'stroke-linecap': 'round',
      }),
      el('path', {
        d: stemPath, fill: 'none', stroke: tone, 'stroke-width': stemWidth,
        opacity: 0.5 + 0.5 * fall, 'stroke-linecap': 'round',
        transform: `translate(${f(stemWidth * 0.3 * light.dx)} 0)`,
      }),
    ]

    // paired leaves at alternating nodes
    const nodes = Math.max(2, Math.round(lerp(3, 9, dens)))
    for (let k = 1; k <= nodes; k++) {
      const t = k / (nodes + 1)
      const idx = Math.min(segs, Math.round(t * segs)) * 2
      const nx2 = pts[idx] as number
      const ny2 = pts[idx + 1] as number
      const leafLen = ctx.short * lerp(0.03, 0.115, leafK) * (0.45 + 0.55 * fall) *
        (1 - t * 0.45) * depthScale
      const spreadA = skel.range(0.55, 1.15)
      for (const side of [-1, 1]) {
        const angle = -Math.PI * 0.5 + side * spreadA
        // The half turned toward the light takes the lit gradient. Both halves
        // of a flat leaf taking one fill is what made these read as cut paper.
        const facesLight = side * -light.dx > 0
        const tipX = nx2 + Math.cos(angle) * leafLen
        const tipY = ny2 + Math.sin(angle) * leafLen

        parts.push(
          el('path', {
            d: leafHalf(nx2, ny2, leafLen, leafLen * 0.34, angle, 1),
            fill: `url(#${uid}-${facesLight ? 'lit' : 'shade'})`,
            opacity: 0.62 + 0.35 * fall,
          }),
          el('path', {
            d: leafHalf(nx2, ny2, leafLen, leafLen * 0.34, angle, -1),
            fill: `url(#${uid}-${facesLight ? 'shade' : 'lit'})`,
            opacity: 0.62 + 0.35 * fall,
          }),
          // the rib, and the reason the two halves read as one leaf
          el('path', {
            d: `M${f(nx2)} ${f(ny2)}L${f(tipX)} ${f(tipY)}`,
            stroke: withAlpha(ctx.ramp(0.95), 0.3 + 0.3 * fall),
            'stroke-width': u(0.9) * depthScale, fill: 'none', 'stroke-linecap': 'round',
          }),
        )
      }
    }

    // seed head, lit as a sphere with a seat under it
    const tipX = pts[pts.length - 2] as number
    const tipY = pts[pts.length - 1] as number
    const headR = u(lerp(3, 11, fall) * leafK * 1.4) * depthScale
    parts.push(
      el('circle', {
        cx: tipX + headR * 0.28 * light.dx, cy: tipY + headR * 0.3, r: headR * 0.95,
        fill: withAlpha(palette.ink, 0.35),
      }),
      el('circle', { cx: tipX, cy: tipY, r: headR, fill: `url(#${uid}-head)` }),
      el('circle', {
        cx: tipX - light.dx * headR * 0.3, cy: tipY - light.dy * headR * 0.3, r: headR * 0.26,
        fill: withAlpha(ctx.ramp(1), 0.6),
      }),
    )

    const stem = el('g', {
      // the far plane sits back in the haze as well as out of focus
      ...(isFar ? { opacity: 0.72 } : {}),
    }, parts.join(''))

    if (isFar) farPlane.push(stem)
    else if (isNear) nearPlane.push(stem)
    else midPlane.push(stem)

    const score = Math.hypot(tipX - focal.cx, tipY - focal.cy) + (isFar || isNear ? ctx.short : 0)
    if (score < accentScore) {
      accentScore = score
      accent =
        el('path', {
          d: stemPath, fill: 'none', stroke: palette.accent,
          'stroke-width': u(2.6 * weightK), opacity: 0.9, 'stroke-linecap': 'round',
        }) +
        el('circle', { cx: tipX, cy: tipY, r: headR, fill: palette.accent }) +
        el('circle', {
          cx: tipX, cy: tipY, r: headR * 2.4, fill: 'none',
          stroke: withAlpha(palette.accent, 0.4), 'stroke-width': u(1.2),
        })
    }
  }

  // --- assemble the planes -------------------------------------------------
  // Far goes behind the form as well as into it, so the haze is continuous
  // across the frame rather than stopping at the mask edge.
  const far = el('g', {
    filter: `url(#${uid}-far)`,
    fill: toward(palette, ctx.ramp(0.4), 0.35),
  }, farPlane.join(''))
  back.push(far)
  behind.push(el('g', { opacity: 0.7 }, far))

  subject.push(...midPlane)
  behind.push(el('g', { opacity: 0.55 }, midPlane.join('')))

  // the near plane is out of focus the other way, and crosses the form edge
  // Kept light. The near plane is there to frame the picture from in front of
  // it, and at full strength it stops being a frame and becomes a veil over
  // everything the composition was actually about.
  front.push(el('g', { filter: `url(#${uid}-near)`, opacity: 0.6 }, nearPlane.join('')))

  // --- pollen --------------------------------------------------------------
  // Motes caught in the light. Small, bright, and slightly out of focus, which
  // is the whole reason they read as being between the viewer and the plants.
  if (pollenK > 0.02) {
    const motes = Math.round(lerp(0, 90, pollenK) * Math.max(0.4, ctx.quality ** 0.5))
    const dust: string[] = []
    for (let i = 0; i < motes; i++) {
      const x = ctx.rng.range(-u(30), w + u(30))
      const y = ctx.rng.range(h * 0.1, h + u(30))
      const mag = ctx.rng.next() ** 2.4
      const fall = ctx.falloff(x, y)
      dust.push(el('circle', {
        cx: x, cy: y, r: u(1.4 + 7 * mag) * (0.5 + 0.7 * fall),
        fill: withAlpha(ctx.ramp(1), (0.16 + 0.4 * mag) * (0.3 + 0.7 * fall)),
      }))
    }
    front.push(el('g', { filter: `url(#${uid}-near)` }, dust.join('')))
  }

  // one stem arcs over the mask edge and out of frame
  const arcX = focal.cx + skel.range(-0.6, 0.6) * focal.rx
  front.push(el('path', {
    d: `M${f(arcX)} ${f(h + u(20))}C${f(arcX + ctx.short * 0.1)} ${f(h * 0.55)},` +
      `${f(arcX - ctx.short * 0.22)} ${f(focal.cy - focal.ry * 0.6)},` +
      `${f(arcX + ctx.short * 0.3)} ${f(focal.cy - focal.ry * 1.3)}`,
    fill: 'none', stroke: withAlpha(ctx.ramp(1), 0.7), 'stroke-width': u(2.6 * weightK),
    'stroke-linecap': 'round',
  }))

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const botanicalStems: Renderer = {
  id: 'botanical-stems',
  name: 'Botanical Stems',
  family: 'organic',
  dark: true,
  focals: ['arch', 'circle', 'ellipse'],
  sampler: 'field',
  schema,
  render,
}
