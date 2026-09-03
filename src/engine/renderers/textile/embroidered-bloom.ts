import { el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Satin stitch worked into a bloom.
 *
 * Embroidery is drawn thread by thread, and that is the whole reason it looks
 * like embroidery: a petal filled with a solid colour is a shape, but the same
 * petal filled with two hundred short parallel stitches has a grain, and the
 * grain catches light differently on each petal because the stitch direction
 * turns with the form.
 *
 * So every stitch here is its own line, laid across the petal's short axis and
 * carrying a slightly different value than its neighbour. That variance is the
 * texture; averaged out it would be a flat fill again.
 *
 * Stitch count scales with quality, but the petal skeleton is drawn from a
 * stream that does not, so the thumbnail and the export are the same flower
 * worked at different fineness.
 */

const schema: ParamSchema = [
  { key: 'petals', label: 'Petals', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.5 },
  { key: 'layers', label: 'Layers', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.5 },
  { key: 'stitch', label: 'Stitch density', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.6 },
  { key: 'twist', label: 'Twist', type: 'range', min: 0, max: 1, step: 0.01, default: 0.4 },
  { key: 'knots', label: 'French knots', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'disc', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette, light, uid } = ctx
  const petalK = ctx.num('petals')
  const layerK = ctx.num('layers')
  const stitchK = ctx.num('stitch')
  const twistK = ctx.num('twist')
  const knotK = ctx.num('knots')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const reach = Math.max(focal.rx, focal.ry)
  const cx = focal.cx
  const cy = focal.cy

  // Ground cloth: a coarse weave showing through, drawn once as a pattern so
  // the count does not scale with the canvas.
  const weave = u(9)
  defs.push(
    el('pattern',
      { id: `${uid}-cloth`, patternUnits: 'userSpaceOnUse', width: weave, height: weave },
      el('rect', { width: weave, height: weave, fill: 'none' }) +
      el('path', {
        d: `M0 ${f(weave / 2)}H${f(weave)}M${f(weave / 2)} 0V${f(weave)}`,
        stroke: withAlpha(ctx.ramp(0.3), 0.4),
        'stroke-width': u(1.1),
      })),
  )
  back.push(el('rect', {
    x: cx - reach * 3, y: cy - reach * 3, width: reach * 6, height: reach * 6,
    fill: `url(#${uid}-cloth)`, opacity: 0.5,
  }))

  // --- the bloom -----------------------------------------------------------
  // Rings alternate by half a petal so the layers interleave rather than
  // stacking on top of each other, which is how a real worked bloom is built
  // up and the only reason the layers stay legible.
  const rings = Math.round(lerp(2, 4, layerK))
  const perRing = Math.round(lerp(6, 12, petalK))

  let accent: string | undefined
  let bestScore = Infinity

  for (let ring = 0; ring < rings; ring++) {
    const rt = rings === 1 ? 0 : ring / (rings - 1)
    // outer petals are longest; inner ones are short and crowd the centre
    const len = reach * lerp(0.62, 0.24, rt)
    const wide = len * lerp(0.34, 0.44, rt)
    const startR = reach * lerp(0.13, 0.04, rt)
    const petals = Math.max(4, Math.round(perRing * lerp(1, 0.7, rt)))
    // half a petal of offset per ring, plus a small twist so it is not rigid
    const spin = skel.range(0, Math.PI * 2) + (ring * Math.PI) / petals + ring * twistK * 0.5

    for (let p = 0; p < petals; p++) {
      if (ctx.expired()) break
      const a = spin + (p / petals) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)

      // how much of the light this petal faces; drives its whole value range
      const facing = (ca * -light.dx + sa * -light.dy) * 0.5 + 0.5
      const tipX = cx + ca * (startR + len)
      const tipY = cy + sa * (startR + len)
      const fall = ctx.falloff(tipX, tipY)

      // Stitch spacing is a fixed distance on the cloth, not a fixed count.
      // A count spreads over a long petal and leaves a scribble of separate
      // lines; a spacing keeps neighbouring stitches touching, which is the
      // whole difference between satin stitch and hatching.
      const gap = u(lerp(9, 4.5, stitchK)) / Math.max(0.55, Math.min(1.6, ctx.quality ** 0.5))
      const rows = Math.max(6, Math.min(140, Math.round(len / gap)))

      // Lay the stitch endpoints out once; the accent redraws the same array
      // rather than recomputing the geometry, which is how the two stay
      // registered with each other.
      const laid: Array<{ x1: number; y1: number; x2: number; y2: number; shade: number }> = []
      for (let st = 0; st <= rows; st++) {
        const t = st / rows
        // petal profile: fattest a third out, tapering to a point at the tip
        const halfW = wide * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.06)) ** 0.7
        const along = startR + len * t
        const mx = cx + ca * along
        const my = cy + sa * along
        // the stitch leans toward the tip, the way a laid satin stitch does
        const lean = 0.3 * t
        const nx = -sa + ca * lean
        const ny = ca + sa * lean
        const nl = Math.hypot(nx, ny) || 1
        const jx = ctx.rng.range(-0.035, 0.035) * wide
        const jy = ctx.rng.range(-0.035, 0.035) * wide
        laid.push({
          x1: mx - (nx / nl) * halfW + jx,
          y1: my - (ny / nl) * halfW + jy,
          x2: mx + (nx / nl) * halfW + jx,
          y2: my + (ny / nl) * halfW + jy,
          // thread-to-thread variance IS the texture; averaged out it is a fill
          shade: Math.max(
            0.1,
            Math.min(1, lerp(0.26, 0.95, facing) * lerp(0.6, 1, 1 - t * 0.5) + ctx.rng.range(-0.08, 0.08)),
          ),
        })
      }

      // stitches overlap slightly so the petal reads as a surface with a grain
      const threadW = u(lerp(11, 6, stitchK)) * lerp(1, 0.8, rt)
      const petal = el('g', { opacity: 0.72 + 0.28 * fall },
        laid
          .map((l) => el('line', {
            x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
            stroke: ctx.ramp(l.shade), 'stroke-width': threadW, 'stroke-linecap': 'round',
          }))
          .join(''))
      subject.push(petal)

      // the outermost ring also falls behind the form, so the bloom is not a
      // disc pasted onto the ground
      if (ring === 0 && p % 2 === 0) behind.push(petal)

      // couching: one laid thread outlining the lit edge of the petal
      if (facing > 0.6) {
        subject.push(el('path', {
          d: `M${f(cx + ca * startR)} ${f(cy + sa * startR)}` +
            `Q${f(cx + ca * (startR + len * 0.5) - sa * wide * 0.85)} ` +
            `${f(cy + sa * (startR + len * 0.5) + ca * wide * 0.85)} ` +
            `${f(tipX)} ${f(tipY)}`,
          fill: 'none',
          stroke: withAlpha(ctx.ramp(1), 0.3),
          'stroke-width': u(1.6),
          'stroke-linecap': 'round',
        }))
      }

      // one petal, the best lit of the outer ring, worked in the accent thread
      const score = (1 - facing) * 2 + rt * 1.5 - fall
      if (score < bestScore) {
        bestScore = score
        // Every third stitch, at a fraction of the width, so the gaps between
        // them stay open. Worked at full width it is not a metallic thread
        // among the others, it is a solid lozenge sitting on the flower.
        accent = el('g', {},
          laid
            .filter((_, i) => i % 3 === 0)
            .map((l) => el('line', {
              x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2,
              stroke: palette.accent, 'stroke-width': threadW * 0.34, 'stroke-linecap': 'round',
              opacity: 0.5 + 0.5 * l.shade,
            }))
            .join(''))
      }
    }
  }

  // --- French knots at the centre -----------------------------------------
  // A knot is a wound bead: a filled dot with a bright cap and a seat, which
  // is why it reads as raised rather than printed.
  const knots = Math.round(lerp(0, 34, knotK) * Math.max(0.5, ctx.quality ** 0.4))
  const knotR = reach * 0.055
  for (let i = 0; i < knots; i++) {
    const a = ctx.rng.range(0, Math.PI * 2)
    const d = reach * lerp(0.02, 0.3, Math.sqrt(ctx.rng.next()))
    const kx = cx + Math.cos(a) * d
    const ky = cy + Math.sin(a) * d
    const r = knotR * ctx.rng.range(0.6, 1.15)
    subject.push(
      el('circle', { cx: kx + u(2) * light.dx, cy: ky + u(2.4), r, fill: withAlpha(palette.ink, 0.45) }),
      el('circle', { cx: kx, cy: ky, r, fill: ctx.ramp(0.55 + ctx.rng.range(-0.12, 0.2)) }),
      el('circle', {
        cx: kx - light.dx * r * 0.35, cy: ky - light.dy * r * 0.35, r: r * 0.42,
        fill: withAlpha(ctx.ramp(1), 0.55),
      }),
    )
  }

  // --- loose threads crossing the edge ------------------------------------
  const strays = Math.round(lerp(1, 5, petalK))
  for (let i = 0; i < strays; i++) {
    const a = skel.range(0, Math.PI * 2)
    const r0 = reach * skel.range(0.7, 1.0)
    const r1 = reach * skel.range(1.3, 2.2)
    const bend = skel.range(-0.7, 0.7)
    front.push(el('path', {
      d: `M${f(cx + Math.cos(a) * r0)} ${f(cy + Math.sin(a) * r0)}` +
        `Q${f(cx + Math.cos(a + bend) * r1 * 0.7)} ${f(cy + Math.sin(a + bend) * r1 * 0.7)} ` +
        `${f(cx + Math.cos(a + bend * 1.6) * r1)} ${f(cy + Math.sin(a + bend * 1.6) * r1)}`,
      fill: 'none',
      stroke: mixHex(ctx.ramp(0.75), palette.ground, 0.15),
      'stroke-width': u(2),
      'stroke-linecap': 'round',
    }))
  }

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const embroideredBloom: Renderer = {
  id: 'embroidered-bloom',
  name: 'Embroidered Bloom',
  family: 'textile',
  dark: false,
  focals: ['circle', 'disc', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
