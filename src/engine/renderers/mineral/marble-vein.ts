import { blob } from '../../sampling'
import { clamp, el, f, lerp, smooth } from '../../svg'
import { withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * Veined marble.
 *
 * The stone is the ground and the picture is what cracked it. Veins are walked
 * through the noise field with a strong directional bias, because a vein is a
 * healed fracture and fractures propagate — they do not wander. The bias is
 * what separates this from every other flow field in the studio: a vein that
 * meanders equally in all directions is a river system, and marble does not
 * look like that.
 *
 * Each vein is three marks on one path, and all three are needed. A dark thin
 * core is the fracture itself. A much wider, very pale copy underneath is the
 * mineral that leached into the stone on either side, and it is the difference
 * between a crack drawn on marble and a vein inside it. And a fine bright
 * hairline offset to the lit side is the polish catching the slight ridge where
 * the two faces met.
 *
 * Branches leave at shallow angles and only ever get thinner, because a
 * fracture splits by losing energy. Anything that branches wide, or gains
 * weight downstream, immediately reads as a plant.
 */

const schema: ParamSchema = [
  { key: 'veins', label: 'Veins', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.5 },
  { key: 'gauge', label: 'Vein weight', type: 'range', min: 0.15, max: 1, step: 0.01, default: 0.45 },
  { key: 'wander', label: 'Wander', type: 'range', min: 0.05, max: 1, step: 0.01, default: 0.42 },
  { key: 'branch', label: 'Branching', type: 'range', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'cloud', label: 'Clouding', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'ellipse', 'portal', 'lens'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { w, h, u, n, palette, focal } = ctx
  const veinK = ctx.num('veins')
  const gaugeK = ctx.num('gauge')
  const wanderK = ctx.num('wander')
  const branchK = ctx.num('branch')
  const cloudK = ctx.num('cloud')

  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const dark = ctx.ramp(1)
  const gauge = u(lerp(1.4, 7, gaugeK))
  const grain = skel.range(0, Math.PI * 2)
  const wave = lerp(520, 150, wanderK)
  const phase = skel.range(0, 400)

  // --- clouding, first ------------------------------------------------------
  if (cloudK > 0.03) {
    const clouds = Math.round(lerp(4, 16, cloudK))
    for (let i = 0; i < clouds; i++) {
      const x = skel.range(-0.1, 1.1) * w
      const y = skel.range(-0.1, 1.1) * h
      behind.push(el('path', {
        d: blob(x, y, ctx.short * skel.range(0.16, 0.5), 13, skel, 0.34),
        fill: withAlpha(ctx.ramp(skel.range(0.1, 0.45)), 0.05 + 0.09 * cloudK),
      }))
    }
  }

  /** Walk one vein from a point, both ways, biased along the grain. */
  const walk = (x0: number, y0: number, dir: number, steps: number): number[] => {
    const step = ctx.short * 0.03
    const pts: number[] = []
    let x = x0
    let y = y0
    let a = dir
    for (let i = 0; i < steps; i++) {
      pts.push(x, y)
      const drift = ctx.fbm((n(x) + phase) / wave, (n(y) - phase) / wave, 3) * wanderK * 1.5
      // pulled back toward the grain, so the vein propagates rather than roams
      a = a * 0.7 + (dir + drift * 2.2) * 0.3
      x += Math.cos(a) * step
      y += Math.sin(a) * step
      if (x < -ctx.short * 0.2 || x > w + ctx.short * 0.2) break
      if (y < -ctx.short * 0.2 || y > h + ctx.short * 0.2) break
    }
    return pts
  }

  /** The three marks that make a vein rather than a crack. */
  const vein = (d: string, weight: number, alpha: number): string =>
    el('path', {
      d, fill: 'none', stroke: withAlpha(dark, 0.13 * alpha),
      'stroke-width': weight * 8, 'stroke-linecap': 'round',
    }) +
    el('path', {
      d, fill: 'none', stroke: withAlpha(dark, 0.88 * alpha),
      'stroke-width': weight, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }) +
    el('path', {
      d, fill: 'none', stroke: withAlpha(ctx.ramp(0.04), 0.4 * alpha),
      'stroke-width': weight * 0.35, 'stroke-linecap': 'round',
      transform: `translate(${f(-weight * 0.7 * ctx.light.dx)} ${f(weight * 0.7 * ctx.light.dy)})`,
    })

  // --- the primaries -------------------------------------------------------
  const primaries = Math.round(lerp(4, 16, veinK))
  type Branch = { x: number; y: number; a: number; weight: number; gen: number }
  const queue: Branch[] = []

  for (let i = 0; i < primaries; i++) {
    const t = (i + 0.5) / primaries
    // strung across the frame perpendicular to the grain, so they run parallel
    const across = (t - 0.5) * 1.5 * ctx.short + skel.range(-1, 1) * u(60)
    const x0 = focal.cx - Math.sin(grain) * across
    const y0 = focal.cy + Math.cos(grain) * across
    const dir = grain + skel.range(-0.3, 0.3)
    const near = ctx.falloff(x0, y0)
    const weight = gauge * skel.range(0.7, 1.5) * (0.55 + 0.7 * near)

    for (const sign of [1, -1]) {
      const pts = walk(x0, y0, dir + (sign < 0 ? Math.PI : 0), 46)
      if (pts.length < 6) continue
      const d = smooth(pts, 0.5)
      const mark = vein(d, weight, 1)
      subject.push(mark)
      back.push(mark)

      // seed the branches from points along the run
      if (branchK > 0.05) {
        const kids = Math.round(lerp(1, 6, branchK))
        for (let k = 0; k < kids; k++) {
          const idx = skel.int(3, Math.max(3, pts.length / 2 - 2)) * 2
          queue.push({
            x: pts[idx] as number,
            y: pts[idx + 1] as number,
            // shallow: a fracture splits forward, never sideways
            a: dir + (sign < 0 ? Math.PI : 0) + skel.range(-0.5, 0.5),
            weight: weight * skel.range(0.35, 0.6),
            gen: 1,
          })
        }
      }
    }
  }

  // --- the branches --------------------------------------------------------
  let guard = 0
  while (queue.length && guard++ < 700) {
    if ((guard & 15) === 0 && ctx.expired()) break
    const b = queue.shift() as Branch
    const pts = walk(b.x, b.y, b.a, Math.round(lerp(26, 10, b.gen / 3)))
    if (pts.length < 6) continue
    const d = smooth(pts, 0.5)
    const mark = vein(d, b.weight, 0.85)
    subject.push(mark)
    back.push(mark)

    if (b.gen >= 4 || b.weight < gauge * 0.12) continue
    const kids = skel.next() < branchK ? skel.int(1, 2) : 0
    for (let k = 0; k < kids; k++) {
      queue.push({
        x: pts[pts.length - 2] as number,
        y: pts[pts.length - 1] as number,
        a: b.a + skel.range(-0.45, 0.45),
        weight: b.weight * skel.range(0.4, 0.65),
        gen: b.gen + 1,
      })
    }
  }

  // --- the polish ----------------------------------------------------------
  // A broad soft sweep across the slab, the way a polished face throws the room
  // back at you. It is what separates marble from limestone.
  const px = focal.cx + skel.range(-0.4, 0.4) * w
  behind.push(el('path', {
    d:
      `M${f(px - w * 0.5)} ${f(-u(30))}L${f(px + w * 0.12)} ${f(-u(30))}` +
      `L${f(px + w * 0.5)} ${f(h + u(30))}L${f(px - w * 0.12)} ${f(h + u(30))}Z`,
    fill: withAlpha(ctx.ramp(0.02), 0.16),
  }))

  // One vein crossing the form edge and leaving the frame at full weight.
  const hero = walk(
    focal.cx + skel.range(-0.5, 0.5) * focal.rx,
    focal.cy + skel.range(-0.5, 0.5) * focal.ry,
    grain + Math.PI * 0.5 + skel.range(-0.4, 0.4),
    60,
  )
  if (hero.length > 6) front.push(vein(smooth(hero, 0.5), gauge * 1.5, 1))

  // --- the accent: the one vein that mineralised in colour ----------------
  const ax = focal.cx + skel.range(-0.6, 0.6) * focal.rx
  const ay = focal.cy + skel.range(-0.6, 0.6) * focal.ry
  const acc = walk(ax, ay, grain + skel.range(-0.4, 0.4), 40)
  const accD = acc.length > 6 ? smooth(acc, 0.5) : ''
  const accent = accD
    ? el('path', {
        d: accD, fill: 'none', stroke: withAlpha(palette.accent, 0.12),
        'stroke-width': gauge * 6, 'stroke-linecap': 'round',
      }) +
      el('path', {
        d: accD, fill: 'none', stroke: palette.accent,
        'stroke-width': gauge * clamp(1.1, 0.5, 2), 'stroke-linecap': 'round',
      })
    : el('circle', { cx: ax, cy: ay, r: gauge * 2, fill: palette.accent })

  return { back, behind, subject, front, accent }
}

export const marbleVein: Renderer = {
  id: 'marble-vein',
  name: 'Marble Vein',
  family: 'mineral',
  dark: false,
  focals: ['circle', 'ellipse', 'portal', 'lens'],
  sampler: 'field',
  schema,
  render,
}
