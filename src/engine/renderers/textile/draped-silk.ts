import { el, f, lerp, smooth } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Cloth hanging in folds.
 *
 * A fold is not a shape, it is a light response: the cloth surface runs
 * through a soft cycle from crest to trough, and everything you read as a fold
 * is where that cycle turns. So the geometry here is one continuous field of
 * hanging lines, and the whole picture is made by filling the gaps between
 * them with a value taken from the surface normal.
 *
 * The normal comes free. Each fold line is a curve of known phase, so the
 * gradient across the gap between two lines is exactly the shading across that
 * facet: bright where the surface turns toward the light, dark where it turns
 * away, and darkest in the crease where the cloth doubles under itself.
 *
 * The folds gather: spacing narrows toward the gather point and opens out
 * below it, which is what stops this reading as corrugation.
 */

const schema: ParamSchema = [
  { key: 'folds', label: 'Folds', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'drape', label: 'Drape', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'sheen', label: 'Sheen', type: 'range', min: 0, max: 1, step: 0.01, default: 0.65 },
  { key: 'gather', label: 'Gather', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'crease', label: 'Crease depth', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'ellipse', 'arch', 'portal'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, focal, palette, light, uid } = ctx
  const foldK = ctx.num('folds')
  const drapeK = ctx.num('drape')
  const sheenK = ctx.num('sheen')
  const gatherK = ctx.num('gather')
  const creaseK = ctx.num('crease')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  // Hang direction.
  //
  // Folds are built in a frame where the cloth falls down the y axis, and the
  // whole frame is then rotated. Doing it the other way round, by tilting the
  // fold lines within a fixed frame, only ever produces near-vertical drape:
  // every seed comes out as the same picture in a different colour, which is
  // the failure mode this family already had once.
  const hang = skel.range(0, Math.PI * 2)
  const tilt = skel.range(-0.26, 0.26)
  const span = Math.hypot(w, h) * 1.25
  const steps = Math.max(16, Math.round(30 * Math.max(0.5, ctx.quality ** 0.5)))

  // where the cloth is gathered: a point the folds converge on
  const gx = focal.cx + skel.gauss() * focal.rx * 0.5
  const gy = focal.cy - focal.ry * lerp(0.4, 1.5, gatherK)

  const count = Math.round(lerp(9, 34, foldK))
  const amp = ctx.short * lerp(0.02, 0.085, drapeK)
  const wobble = lerp(0.0012, 0.0034, drapeK)
  const phase = skel.range(0, 20)

  // Fold x at a given height, in the cloth's own frame. Spacing is squeezed
  // near the gather and released below it.
  const foldX = (i: number, y: number) => {
    const t = i / (count - 1)
    const toward = 1 / (1 + Math.abs(y - gy) / (ctx.short * lerp(1.4, 0.5, gatherK)))
    const pinch = lerp(1, 0.18, gatherK * toward)
    const base = lerp(-span * 0.5, span * 0.5, t) * pinch + gx * (1 - pinch)
    const sag = (y - gy) * tilt
    const drift = ctx.fbm(n(base) * wobble + phase, n(y) * wobble * 0.55, 3) * amp
    return base + sag + drift + Math.sin(t * 9.1 + phase) * amp * 0.4
  }

  const line = (i: number) => {
    const pts: number[] = []
    for (let s = 0; s <= steps; s++) {
      const y = lerp(-span * 0.3, h + span * 0.3, s / steps)
      pts.push(foldX(i, y), y)
    }
    return pts
  }

  // Facet gradients. One per fold pair would be hundreds of defs, so the shade
  // is quantised into a small set the facets share; the eye reads the cycle,
  // not the individual stop.
  const SHADES = 7
  for (let k = 0; k < SHADES; k++) {
    const t = k / (SHADES - 1)
    // the surface turning: bright at the crest, falling into the crease
    const litSide = ctx.ramp(lerp(0.28, 0.98, t))
    const darkSide = mixHex(ctx.ramp(lerp(0.12, 0.6, t)), palette.ink, lerp(0.5, 0.12, t))
    defs.push(
      el('linearGradient',
        {
          id: `${uid}-fold${k}`, gradientUnits: 'objectBoundingBox',
          x1: light.dx < 0 ? '100%' : '0%', y1: '0%',
          x2: light.dx < 0 ? '0%' : '100%', y2: '0%',
        },
        el('stop', { offset: '0%', 'stop-color': darkSide }) +
        el('stop', { offset: f(lerp(30, 46, sheenK)) + '%', 'stop-color': litSide }) +
        el('stop', { offset: '100%', 'stop-color': mixHex(darkSide, palette.ink, 0.25 * creaseK) })),
    )
  }

  let accent: string | undefined
  let bestLit = -Infinity

  let prev = line(0)
  for (let i = 1; i < count; i++) {
    if ((i & 7) === 0 && ctx.expired()) break
    const cur = line(i)

    // the facet between two fold lines, closed down one and back up the other
    const backEdge: number[] = []
    for (let s = cur.length - 2; s >= 0; s -= 2) {
      backEdge.push(cur[s] as number, cur[s + 1] as number)
    }
    const d = `${smooth(prev, 0.5)}L${f(backEdge[0] as number)} ${f(backEdge[1] as number)}${smooth(backEdge, 0.5).slice(1)}Z`

    // Where in the fold cycle this facet sits. Two full cycles across the
    // cloth would read as stripes, so the cycle length itself drifts.
    const cyc = (Math.sin(i * lerp(0.55, 1.15, drapeK) + phase) + 1) / 2
    const shade = Math.min(SHADES - 1, Math.round(cyc * (SHADES - 1)))

    const midY = h * 0.5
    const fall = ctx.falloff(foldX(i, midY), midY)

    // Solid. A translucent facet lets the compositor's form fill through and
    // the focal edge then reads as a change of value in the cloth, which cloth
    // does not do.
    subject.push(el('path', { d, fill: `url(#${uid}-fold${shade})` }))

    // The crease: a dark hairline in the trough only, never on the crest. This
    // is the single mark that makes cloth read as cloth rather than a gradient.
    if (cyc < 0.22) {
      subject.push(el('path', {
        d: smooth(prev, 0.5),
        fill: 'none',
        stroke: withAlpha(palette.ink, (0.2 + 0.45 * creaseK) * (0.4 + 0.6 * fall)),
        'stroke-width': u(lerp(1.2, 4.5, creaseK)),
        'stroke-linecap': 'round',
      }))
    }

    // a fine specular thread riding the crest
    if (cyc > 0.8) {
      const thread = el('path', {
        d: smooth(prev, 0.5),
        fill: 'none',
        stroke: withAlpha(ctx.ramp(1), 0.22 + 0.5 * sheenK),
        'stroke-width': u(lerp(0.6, 2.2, sheenK)),
        'stroke-linecap': 'round',
      })
      subject.push(thread)
      if (i % 5 === 0) front.push(thread)

      const lit = fall * cyc
      if (lit > bestLit) {
        bestLit = lit
        // Only the stretch of crest nearest the subject, not the full drop:
        // a thread running the whole height lands in the same place in every
        // composition and reads as a scratch on the lens.
        const mid = Math.floor(prev.length / 4) & ~1
        const seg = prev.slice(mid, mid + Math.max(8, (prev.length / 2) | 1) - 1)
        const dSeg = smooth(seg, 0.5)
        accent =
          el('path', {
            d: dSeg, fill: 'none', stroke: palette.accent,
            'stroke-width': u(2.8), 'stroke-linecap': 'round',
          }) +
          el('path', {
            d: dSeg, fill: 'none',
            stroke: withAlpha(palette.accent, 0.3), 'stroke-width': u(7),
            'stroke-linecap': 'round',
          })
      }
    }

    // The same cloth continues outside the form, a little flatter and cooler,
    // so the form reads as a lit panel of one continuous drape rather than a
    // hole cut in it.
    back.push(el('path', {
      d, fill: `url(#${uid}-fold${shade})`, opacity: 0.62 + 0.2 * fall,
    }))
    if (i % 4 === 1) behind.push(el('path', { d, fill: withAlpha(ctx.ramp(0.42), 0.3) }))

    prev = cur
  }

  // The gather itself: a knot of short creases converging where the cloth is
  // held, which is the one place the eye looks for an explanation of the folds.
  const knot = Math.round(lerp(4, 12, gatherK))
  for (let i = 0; i < knot; i++) {
    const a = skel.range(0, Math.PI * 2)
    const r = ctx.short * skel.range(0.02, 0.09)
    subject.push(el('path', {
      d: `M${f(gx)} ${f(gy)}Q${f(gx + Math.cos(a) * r * 0.6)} ${f(gy + Math.sin(a) * r * 0.6)} ` +
        `${f(gx + Math.cos(a) * r)} ${f(gy + Math.sin(a) * r * 1.4)}`,
      fill: 'none',
      stroke: withAlpha(palette.ink, 0.3 * creaseK),
      'stroke-width': u(2.2),
      'stroke-linecap': 'round',
    }))
  }

  // Everything the cloth is made of turns together, about the subject, so the
  // drape direction is a property of the composition rather than of the code.
  const spin = `rotate(${f((hang * 180) / Math.PI)} ${f(focal.cx)} ${f(focal.cy)})`
  const turn = (layer: string[]) => (layer.length ? [el('g', { transform: spin }, layer.join(''))] : [])

  const scene = {
    back: turn(back),
    behind: turn(behind),
    subject: turn(subject),
    front: turn(front),
    defs,
  }
  return accent ? { ...scene, accent: el('g', { transform: spin }, accent) } : scene
}

export const drapedSilk: Renderer = {
  id: 'draped-silk',
  name: 'Draped Silk',
  family: 'textile',
  dark: false,
  focals: ['ellipse', 'arch', 'portal'],
  sampler: 'field',
  schema,
  render,
}
