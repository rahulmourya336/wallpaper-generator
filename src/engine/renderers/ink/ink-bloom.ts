import { blob } from '../../sampling'
import { clamp, el, f, lerp, poly, smooth } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A drop of ink opening in water.
 *
 * The shape of a real bloom is decided by an instability: the front of the
 * spreading drop is heavier than the water it is pushing into, so any part of
 * it that gets slightly ahead gets more push and runs away as a finger. That is
 * a branching process with the branch rate rising as the front slows, and this
 * is that process, run for four or five generations from the rim of the blot.
 *
 * Two consequences are worth stating, because they are what stop it looking
 * like a tree. Tendrils thin as they go and each child starts thinner than its
 * parent left off, so the whole figure loses mass outward — a tree gains it.
 * And the branch angles are small and biased outward, because the fluid has
 * momentum; a tree branches wide because it is competing for light.
 *
 * The wash under the whole thing is what says water rather than paper. It is
 * three or four very pale blobs, much larger than the ink, offset from it —
 * the colour that has already diffused past the point of having an edge.
 */

const schema: ParamSchema = [
  { key: 'spread', label: 'Spread', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'branch', label: 'Branching', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.55 },
  { key: 'blot', label: 'Blot size', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.45 },
  { key: 'wash', label: 'Wash', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'spatter', label: 'Spatter', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'lens'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, palette, focal } = ctx
  const spreadK = ctx.num('spread')
  const branchK = ctx.num('branch')
  const blotK = ctx.num('blot')
  const washK = ctx.num('wash')
  const spatterK = ctx.num('spatter')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const ink = ctx.ramp(1)
  const core = Math.max(focal.rx, focal.ry) * lerp(0.16, 0.5, blotK)
  const reach = ctx.short * lerp(0.22, 0.72, spreadK)

  // --- the wash ------------------------------------------------------------
  if (washK > 0.03) {
    const clouds = Math.round(lerp(2, 6, washK))
    for (let i = 0; i < clouds; i++) {
      const a = skel.range(0, Math.PI * 2)
      const d = skel.range(0.1, 0.8) * reach
      behind.push(el('path', {
        d: blob(
          focal.cx + Math.cos(a) * d,
          focal.cy + Math.sin(a) * d,
          reach * skel.range(0.5, 1.15), 11, skel, 0.3,
        ),
        fill: withAlpha(mixHex(ink, palette.ground, 0.3), 0.05 + 0.07 * washK),
      }))
    }
  }

  // --- the tendrils --------------------------------------------------------
  /**
   * Grown iteratively rather than recursively.
   *
   * A queue makes the generation limit and the wall-clock check trivial, and it
   * keeps the whole bloom breadth-first — which matters, because a depth-first
   * growth spends its entire budget on the first finger it happens to pick and
   * leaves the rest of the rim bare.
   */
  type Seed = { x: number; y: number; a: number; wide: number; gen: number }
  const queue: Seed[] = []
  const fingers = Math.round(lerp(8, 22, branchK))
  for (let i = 0; i < fingers; i++) {
    const a = (i / fingers) * Math.PI * 2 + skel.range(-0.25, 0.25)
    queue.push({
      x: focal.cx + Math.cos(a) * core * 0.9,
      y: focal.cy + Math.sin(a) * core * 0.9,
      a,
      wide: u(lerp(8, 26, blotK)) * skel.range(0.7, 1.3),
      gen: 0,
    })
  }

  const maxGen = 4
  const tendrils: { poly: string; pts: number[]; wide: number; tone: string }[] = []
  let guard = 0
  while (queue.length && guard++ < 360) {
    if ((guard & 15) === 0 && ctx.expired()) break
    const s = queue.shift() as Seed
    const steps = 16
    const step = (reach / (maxGen + 0.6)) / steps
    const pts: number[] = []
    let x = s.x
    let y = s.y
    let a = s.a
    for (let i = 0; i < steps; i++) {
      pts.push(x, y)
      // the fluid wanders, but momentum keeps it pointing outward
      a += ctx.noise2(n(x) / 190, n(y) / 190) * 0.16 + skel.range(-0.02, 0.02)
      x += Math.cos(a) * step
      y += Math.sin(a) * step
      if (x < -u(60) || x > w + u(60) || y < -u(60) || y > h + u(60)) break
    }
    if (pts.length < 6) continue

    const tone = mixHex(ink, palette.ground, 0.05 + 0.16 * s.gen)
    tendrils.push({ poly: poly(pts), pts, wide: s.wide, tone })

    if (s.gen >= maxGen) continue
    // children start thinner than the parent finished, so mass falls outward
    const kids = skel.next() < 0.35 + 0.5 * branchK ? skel.int(1, 3) : 1
    for (let k = 0; k < kids; k++) {
      const narrower = s.wide * skel.range(0.3, 0.55)
      if (narrower < u(0.7)) continue
      queue.push({
        x, y,
        a: a + skel.range(-0.34, 0.34) * (0.4 + 0.8 * branchK),
        wide: narrower,
        gen: s.gen + 1,
      })
    }
  }

  /**
   * Every finger tapers, and that is not decoration.
   *
   * A tendril of constant width is a wire. The ink runs out as the front
   * advances, so the mark has to lose weight along its own length — and since
   * an SVG stroke has exactly one width, the run is drawn as a short stack of
   * overlapping sub-paths, each narrower than the last. Four steps is enough:
   * the round caps close the joints and the eye reads a continuous taper.
   */
  const STEPS = 3
  for (const t of tendrils) {
    const n = t.pts.length / 2
    if (n < 4) continue
    let mark = ''
    for (let s = 0; s < STEPS; s++) {
      const a = Math.floor((s / STEPS) * (n - 1))
      const b = Math.min(n - 1, Math.ceil(((s + 1) / STEPS) * (n - 1)) + 1)
      if (b - a < 2) continue
      const d = poly(t.pts.slice(a * 2, (b + 1) * 2))
      mark += el('path', {
        d, fill: 'none', stroke: t.tone,
        'stroke-width': t.wide * (1 - (s / STEPS) * 0.88),
        'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      })
    }
    // the halo each finger carries into the paper
    behind.push(el('path', {
      d: t.poly, fill: 'none', stroke: withAlpha(t.tone, 0.14),
      'stroke-width': t.wide * 3.2, 'stroke-linecap': 'round',
    }))
    subject.push(mark)
    back.push(mark)
  }

  // --- the blot ------------------------------------------------------------
  const blotD = blob(focal.cx, focal.cy, core, 14, skel, 0.24)
  subject.push(
    el('path', { d: blotD, fill: withAlpha(ink, 0.18), transform: `scale(1)` }),
    el('path', { d: blob(focal.cx, focal.cy, core * 0.82, 13, skel, 0.2), fill: ink }),
  )
  back.push(el('path', { d: blotD, fill: withAlpha(ink, 0.85) }))

  // --- spatter -------------------------------------------------------------
  if (spatterK > 0.02) {
    const spots = Math.round(lerp(10, 90, spatterK) * clamp(ctx.quality, 0.3, 2))
    for (let i = 0; i < spots; i++) {
      const a = ctx.rng.range(0, Math.PI * 2)
      const d = ctx.rng.next() ** 0.5 * reach * 1.5
      const x = focal.cx + Math.cos(a) * d
      const y = focal.cy + Math.sin(a) * d
      if (x < 0 || x > w || y < 0 || y > h) continue
      const r = u(ctx.rng.range(0.5, 4)) * (1 - d / (reach * 1.6))
      if (r <= 0) continue
      back.push(el('circle', {
        cx: x, cy: y, r, fill: withAlpha(ink, ctx.rng.range(0.25, 0.8)),
      }))
    }
  }

  // A finger that got away, crossing the form edge and running off frame.
  const ea = skel.range(0, Math.PI * 2)
  const escape: number[] = []
  let ex = focal.cx + Math.cos(ea) * core
  let ey = focal.cy + Math.sin(ea) * core
  let eang = ea
  for (let i = 0; i < 40; i++) {
    escape.push(ex, ey)
    eang += ctx.noise2(n(ex) / 130, n(ey) / 130) * 0.3
    ex += Math.cos(eang) * ctx.short * 0.045
    ey += Math.sin(eang) * ctx.short * 0.045
  }
  front.push(el('path', {
    d: smooth(escape, 0.45), fill: 'none', stroke: withAlpha(ink, 0.85),
    'stroke-width': u(lerp(3, 9, blotK)), 'stroke-linecap': 'round',
  }))

  // --- the accent: a second colour dropped in beside the first -------------
  const aa = skel.range(0, Math.PI * 2)
  const ax = focal.cx + Math.cos(aa) * core * skel.range(1.4, 2.6)
  const ay = focal.cy + Math.sin(aa) * core * skel.range(1.4, 2.6)
  const ar = core * skel.range(0.3, 0.55)
  const accent =
    el('path', { d: blob(ax, ay, ar * 2.3, 12, skel, 0.32), fill: withAlpha(palette.accent, 0.13) }) +
    el('path', { d: blob(ax, ay, ar, 11, skel, 0.26), fill: palette.accent }) +
    Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2 + aa
      return el('path', {
        d:
          `M${f(ax + Math.cos(a) * ar * 0.9)} ${f(ay + Math.sin(a) * ar * 0.9)}` +
          `L${f(ax + Math.cos(a) * ar * skel.range(1.8, 3.2))} ${f(ay + Math.sin(a) * ar * skel.range(1.8, 3.2))}`,
        stroke: withAlpha(palette.accent, 0.7), 'stroke-width': u(skel.range(1.4, 4)),
        'stroke-linecap': 'round', fill: 'none',
      })
    }).join('')

  return { back, behind, subject, front, accent }
}

export const inkBloom: Renderer = {
  id: 'ink-bloom',
  name: 'Ink Bloom',
  family: 'ink',
  dark: false,
  focals: ['circle', 'ellipse', 'lens'],
  sampler: 'field',
  schema,
  render,
}
