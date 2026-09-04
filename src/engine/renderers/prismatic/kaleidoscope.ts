import { blob } from '../../sampling'
import { clamp, el, f, lerp } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A wedge of debris, mirrored round a circle.
 *
 * Everything in this file is one small pile of shapes. The picture is what
 * happens when that pile is reflected, and the reflection is the entire point:
 * a random scatter is noise, and the same scatter mirrored twelve times is a
 * rosette that reads as designed. That is not a trick of this renderer, it is
 * how the actual instrument works — two mirrors and some broken glass.
 *
 * The wedge is emitted once into defs and placed with <use>. Repeating the
 * source string sixteen times would be sixteen times the markup for an image
 * the browser is going to draw from one description anyway, and this family's
 * whole cost model is that the interesting part is free.
 *
 * Alternate placements are mirrored rather than merely rotated, so adjacent
 * wedges meet as reflections across their shared edge. Rotation alone leaves a
 * seam at every join — the pattern spins instead of folding, and the eye reads
 * it as a wheel rather than as glass.
 */

const schema: ParamSchema = [
  { key: 'folds', label: 'Mirrors', type: 'range', min: 3, max: 14, step: 1, default: 7 },
  { key: 'shards', label: 'Shards', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.55 },
  { key: 'reach', label: 'Reach', type: 'range', min: 0.3, max: 1, step: 0.01, default: 0.7 },
  { key: 'rings', label: 'Rings', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'chroma', label: 'Contrast', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.62 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'lens', 'diamond'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, palette, focal, uid } = ctx
  const folds = Math.max(3, Math.round(ctx.num('folds')))
  const shardK = ctx.num('shards')
  const reachK = ctx.num('reach')
  const ringK = ctx.num('rings')
  const chromaK = ctx.num('chroma')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const cx = focal.cx
  const cy = focal.cy
  // The pattern has to reach the corners or the frame shows bare ground in the
  // gaps between the wedge tips and the edge.
  const reach = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(w - cx, cy),
    Math.hypot(cx, h - cy),
    Math.hypot(w - cx, h - cy),
  ) * lerp(0.7, 1.06, reachK)

  const half = Math.PI / folds
  const spin = skel.range(0, 360)

  // --- the wedge -----------------------------------------------------------
  /**
   * Shapes are placed in polar coordinates inside a half-wedge and then
   * mirrored, so every piece meets its own reflection on the centre line. A
   * shape dropped anywhere in the full wedge would be cut by the clip at one
   * edge and float free at the other.
   */
  const inner: string[] = []
  const count = Math.round(lerp(14, 46, shardK))
  for (let i = 0; i < count; i++) {
    const t = (i + skel.range(0.05, 0.5)) / count
    const dist = reach * (0.08 + 0.92 * t ** 0.85)
    const off = skel.range(0, half * 0.82)
    const size = reach * lerp(0.1, 0.022, t) * skel.range(0.5, 1.9)
    const tone = ctx.ramp(clamp(0.22 + chromaK * skel.range(0.1, 1.1) * (1 - 0.35 * t), 0, 1))
    const opacity = skel.range(0.45, 0.95) * (1 - 0.25 * t)
    const x = cx + Math.cos(off - Math.PI / 2) * dist
    const y = cy + Math.sin(off - Math.PI / 2) * dist

    const roll = skel.next()
    if (roll < 0.34) {
      // a chip
      const chip = blob(x, y, size, skel.int(3, 6), skel, 0.3)
      inner.push(
        el('path', { d: chip, fill: tone, opacity: (opacity * 0.8).toFixed(3) }),
        // Every chip carries a lit edge. Without it the fills stack into one
        // pale mass and the picture is blobs; a kaleidoscope is cut glass, and
        // what you actually see of cut glass is its edges.
        el('path', {
          d: chip, fill: 'none',
          stroke: withAlpha(ctx.ramp(1), 0.45 * opacity),
          'stroke-width': u(0.9),
        }),
      )
    } else if (roll < 0.6) {
      // a petal: an arc segment of the annulus at this radius
      const a0 = -Math.PI / 2 + off - size / dist
      const a1 = -Math.PI / 2 + off + size / dist
      const r0 = dist - size * 0.7
      const r1 = dist + size * 0.7
      inner.push(el('path', {
        d:
          `M${f(cx + Math.cos(a0) * r0)} ${f(cy + Math.sin(a0) * r0)}` +
          `A${f(r0)} ${f(r0)} 0 0 1 ${f(cx + Math.cos(a1) * r0)} ${f(cy + Math.sin(a1) * r0)}` +
          `L${f(cx + Math.cos(a1) * r1)} ${f(cy + Math.sin(a1) * r1)}` +
          `A${f(r1)} ${f(r1)} 0 0 0 ${f(cx + Math.cos(a0) * r1)} ${f(cy + Math.sin(a0) * r1)}Z`,
        fill: tone, opacity: opacity.toFixed(3),
      }))
    } else if (roll < 0.82) {
      // a ray, running back toward the centre
      inner.push(el('path', {
        d: `M${f(cx)} ${f(cy)}L${f(x)} ${f(y)}`,
        stroke: tone, 'stroke-width': u(skel.range(0.9, 4.5)),
        'stroke-linecap': 'round', fill: 'none',
        opacity: (opacity * 0.7).toFixed(3),
      }))
    } else {
      // a bead
      inner.push(el('circle', {
        cx: x, cy: y, r: size * 0.5, fill: tone, opacity: opacity.toFixed(3),
      }))
    }
  }

  // Concentric hairlines tie the wedges together into one object rather than
  // leaving a ring of unrelated piles.
  if (ringK > 0.03) {
    const rings = Math.round(lerp(4, 20, ringK))
    for (let i = 0; i < rings; i++) {
      const r = reach * ((i + 0.6) / rings) ** 0.9
      inner.push(el('circle', {
        cx, cy, r, fill: 'none',
        stroke: withAlpha(ctx.ramp(0.85), skel.range(0.16, 0.42)),
        'stroke-width': u(skel.range(0.6, 2.2)),
      }))
    }
  }

  defs.push(
    el('clipPath', { id: `${uid}-wedge`, clipPathUnits: 'userSpaceOnUse' },
      el('path', {
        d:
          `M${f(cx)} ${f(cy)}` +
          `L${f(cx + Math.cos(-Math.PI / 2 - half) * reach * 1.3)} ${f(cy + Math.sin(-Math.PI / 2 - half) * reach * 1.3)}` +
          `A${f(reach * 1.3)} ${f(reach * 1.3)} 0 0 1 ` +
          `${f(cx + Math.cos(-Math.PI / 2 + half) * reach * 1.3)} ${f(cy + Math.sin(-Math.PI / 2 + half) * reach * 1.3)}Z`,
      })),
    el('g', { id: `${uid}-cell`, 'clip-path': `url(#${uid}-wedge)` }, inner.join('')),
  )

  // --- the mirror group ----------------------------------------------------
  const wheel: string[] = []
  for (let i = 0; i < folds * 2; i++) {
    const deg = (i * 180) / folds
    // every other placement is the mirror image, so wedges meet edge to edge
    const mirror = i % 2 === 1
      ? ` translate(${f(cx)} ${f(cy)}) scale(-1 1) translate(${f(-cx)} ${f(-cy)})`
      : ''
    wheel.push(el('use', {
      href: `#${uid}-cell`,
      transform: `rotate(${f(deg)} ${f(cx)} ${f(cy)})${mirror}`,
    }))
  }
  const rosette = el('g', { transform: `rotate(${f(spin)} ${f(cx)} ${f(cy)})` }, wheel.join(''))

  behind.push(rosette)
  subject.push(rosette)
  back.push(el('g', { opacity: 0.4 }, rosette))

  // A faint second rosette, larger and counter-turned, so the field has depth
  // instead of being one flat medallion on a plain ground.
  back.push(el('g', {
    transform: `rotate(${f(-spin * 0.6)} ${f(cx)} ${f(cy)}) translate(${f(cx)} ${f(cy)}) scale(1.9) translate(${f(-cx)} ${f(-cy)})`,
    opacity: 0.16,
  }, wheel.join('')))

  // One shard escaping the pattern entirely, over the form edge and off frame.
  const escA = skel.range(0, Math.PI * 2)
  front.push(el('path', {
    d: blob(
      cx + Math.cos(escA) * reach * 0.55,
      cy + Math.sin(escA) * reach * 0.55,
      u(skel.range(40, 90)), skel.int(3, 5), skel, 0.34,
    ),
    fill: ctx.ramp(0.55),
    stroke: withAlpha(ctx.ramp(1), 0.5),
    'stroke-width': u(1.8),
    opacity: 0.9,
  }))

  // --- the accent: the eye at the centre of the mirrors --------------------
  const eye = reach * 0.03
  const accent =
    el('circle', { cx, cy, r: eye, fill: palette.accent }) +
    el('circle', {
      cx, cy, r: eye * 2.4, fill: 'none',
      stroke: withAlpha(palette.accent, 0.45), 'stroke-width': u(2),
    }) +
    Array.from({ length: folds }, (_, i) => {
      const a = (i / folds) * Math.PI * 2 + (spin * Math.PI) / 180
      return el('path', {
        d:
          `M${f(cx + Math.cos(a) * eye * 1.5)} ${f(cy + Math.sin(a) * eye * 1.5)}` +
          `L${f(cx + Math.cos(a) * eye * 3.6)} ${f(cy + Math.sin(a) * eye * 3.6)}`,
        stroke: withAlpha(palette.accent, 0.5), 'stroke-width': u(1.4),
        'stroke-linecap': 'round', fill: 'none',
      })
    }).join('')

  return { back, behind, subject, front, defs, accent }
}

export const kaleidoscope: Renderer = {
  id: 'kaleidoscope',
  name: 'Kaleidoscope',
  family: 'prismatic',
  dark: true,
  focals: ['circle', 'lens', 'diamond'],
  sampler: 'field',
  schema,
  render,
}
