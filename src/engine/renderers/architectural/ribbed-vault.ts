import { el, f, lerp } from '../../svg'
import { mixHex, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * A fan vault seen from directly below.
 *
 * Looking straight up a vault is one of the few genuinely radial pieces of
 * architecture, and it gives a composition a centre without a single circle in
 * it. Ribs spring from a small number of piers, fan out as they climb, and
 * meet at the boss overhead; the cloth of the vault is the web between them.
 *
 * The construction is a polar one, because the thing itself is polar. Ribs are
 * arcs of increasing curvature from each springer, webs are the quads between
 * adjacent ribs, and shading follows the angle between the web's own surface
 * and the light: a web facing the window is pale, the one opposite it is not.
 * That single rule is what gives the fan its turn, and it costs one cosine.
 */

const schema: ParamSchema = [
  { key: 'springers', label: 'Springers', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.45 },
  { key: 'ribs', label: 'Ribs per fan', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'lift', label: 'Vault lift', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'web', label: 'Web shading', type: 'range', min: 0, max: 1, step: 0.01, default: 0.7 },
  { key: 'boss', label: 'Boss', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'circle', 'diamond', 'portal'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const skel = ctx.fork('skeleton')
  const { u, focal, palette, light, uid } = ctx
  const springK = ctx.num('springers')
  const ribK = ctx.num('ribs')
  const liftK = ctx.num('lift')
  const webK = ctx.num('web')
  const bossK = ctx.num('boss')

  const defs: string[] = []
  const back: string[] = []
  const behind: string[] = []
  const subject: string[] = []
  const front: string[] = []

  const cx = focal.cx
  const cy = focal.cy
  const reach = Math.max(focal.rx, focal.ry)

  // The boss is the crown of the vault, a little off centre so the view is
  // from a person standing somewhere rather than from a survey point.
  const bx = cx + skel.gauss() * reach * 0.16
  const by = cy + skel.gauss() * reach * 0.16

  // Springers: where the fans start, out at the edge of the bay.
  const fans = Math.round(lerp(4, 8, springK))
  const spin = skel.range(0, Math.PI * 2)
  // The springers sit just outside the form, not far outside it: pushed out
  // to twice the reach the conoids are clipped down to a knot of ribs around
  // the boss and the bay reads as empty.
  const springR = reach * lerp(0.92, 1.3, liftK)

  defs.push(
    // the vault washed with light from the clerestory
    el('radialGradient',
      { id: `${uid}-crown`, gradientUnits: 'userSpaceOnUse', cx: bx, cy: by, r: springR },
      el('stop', { offset: '0%', 'stop-color': withAlpha(ctx.ramp(0.95), 0.6) }) +
      el('stop', { offset: '48%', 'stop-color': withAlpha(ctx.ramp(0.6), 0.22) }) +
      el('stop', { offset: '100%', 'stop-color': withAlpha(mixHex(ctx.ramp(0.25), palette.ink, 0.4), 0.5) })),
  )

  // The shell of the vault, behind everything.
  //
  // It goes in BOTH layers on purpose. `back` is clipped to the inverse of the
  // focal form, so a shell pushed there alone leaves the inside of the form as
  // bare ground and the gaps between conoids read as holes punched through the
  // vault.
  const shell = el('circle', { cx: bx, cy: by, r: springR, fill: `url(#${uid}-crown)` })
  back.push(shell)
  behind.push(
    el('circle', { cx: bx, cy: by, r: springR, fill: mixHex(palette.ground, ctx.ramp(0.4), 0.55) }),
    shell,
  )

  // Every rib of one fan leaves the SAME springer and arrives at the SAME
  // boss; they differ only in how hard they bow. That is what a fan vault
  // conoid is, and it is why a fan reads as one leaf rather than a spray of
  // separate lines. An earlier version varied the springing angle instead,
  // which is a spray of separate lines.
  const rib = (a: number, bow: number) => {
    const sx = cx + Math.cos(a) * springR
    const sy = cy + Math.sin(a) * springR
    const dx = bx - sx
    const dy = by - sy
    const l = Math.hypot(dx, dy) || 1
    // control point pushed off the chord midpoint, perpendicular
    const kx = (sx + bx) / 2 + (-dy / l) * bow
    const ky = (sy + by) / 2 + (dx / l) * bow
    return {
      sx, sy, kx, ky,
      d: `M${f(sx)} ${f(sy)}Q${f(kx)} ${f(ky)} ${f(bx)} ${f(by)}`,
      // the quadratic's own midpoint, which is where the web actually sits
      mx: (sx + 2 * kx + bx) / 4,
      my: (sy + 2 * ky + by) / 4,
    }
  }

  const perFan = Math.round(lerp(3, 9, ribK))
  // Bow far enough that the outermost ribs of neighbouring fans nearly meet,
  // so the conoids tile the bay instead of leaving wedges of bare vault.
  const maxBow = springR * Math.sin(Math.PI / fans) * lerp(0.75, 1.2, ribK)

  let accent: string | undefined
  let bestLit = -Infinity

  for (let fanI = 0; fanI < fans; fanI++) {
    if (ctx.expired()) break
    const centreA = spin + (fanI / fans) * Math.PI * 2

    let prev = rib(centreA, -maxBow)
    for (let r = 1; r <= perFan; r++) {
      const t = r / perFan
      const cur = rib(centreA, lerp(-maxBow, maxBow, t))

      // The web panel between two ribs: out along one, back along the other.
      // A quadratic reversed keeps its control point, so the return leg is the
      // same curve written backwards.
      const web =
        `M${f(prev.sx)} ${f(prev.sy)}Q${f(prev.kx)} ${f(prev.ky)} ${f(bx)} ${f(by)}` +
        `Q${f(cur.kx)} ${f(cur.ky)} ${f(cur.sx)} ${f(cur.sy)}Z`

      // The panel faces outward from the boss along its own midpoint, so one
      // dot with the light direction gives the whole fan its turn.
      const wx = (prev.mx + cur.mx) / 2
      const wy = (prev.my + cur.my) / 2
      const wl = Math.hypot(wx - bx, wy - by) || 1
      const facing = (((wx - bx) / wl) * -light.dx + ((wy - by) / wl) * -light.dy) * 0.5 + 0.5
      // Webs are plaster, not holes. Taken to the bottom of the ramp the
      // shaded side goes to near-black and the vault reads as cut-out wedges.
      const tone = lerp(0.28, 0.9, lerp(0.5, facing, webK))

      const panel = el('path', {
        d: web,
        fill: ctx.ramp(tone),
        opacity: 0.7 + 0.3 * ctx.falloff(wx, wy),
      })
      subject.push(panel)
      // the same vault continues past the form edge, a little dimmer
      behind.push(el('g', { opacity: 0.6 }, panel))

      // the rib itself: a moulding, so it gets a dark bed and a lit arris
      subject.push(
        el('path', {
          d: cur.d, fill: 'none',
          stroke: mixHex(ctx.ramp(0.28), palette.ink, 0.4),
          'stroke-width': u(6.5),
          'stroke-linecap': 'round',
        }),
        el('path', {
          d: cur.d, fill: 'none',
          stroke: ctx.ramp(lerp(0.5, 1, facing)),
          'stroke-width': u(3.2),
          'stroke-linecap': 'round',
          transform: `translate(${f(u(1.6) * light.dx)} ${f(-u(1.6) * light.dy)})`,
        }),
      )

      if (facing > bestLit) {
        bestLit = facing
        accent = el('path', {
          d: cur.d, fill: 'none', stroke: palette.accent, 'stroke-width': u(2.6),
          'stroke-linecap': 'round',
        })
      }

      prev = cur
    }

    // The springer: the clustered pier the whole conoid grows out of.
    const sx = cx + Math.cos(centreA) * springR
    const sy = cy + Math.sin(centreA) * springR
    behind.push(el('circle', {
      cx: sx + u(6) * light.dx, cy: sy + u(8), r: reach * 0.1,
      fill: withAlpha(palette.ink, 0.4),
    }))
    subject.push(
      el('circle', { cx: sx, cy: sy, r: reach * 0.085, fill: mixHex(ctx.ramp(0.55), palette.ground, 0.1) }),
      el('circle', {
        cx: sx - light.dx * reach * 0.03, cy: sy - light.dy * reach * 0.03, r: reach * 0.04,
        fill: withAlpha(ctx.ramp(0.95), 0.5),
      }),
    )
  }

  // --- the boss ------------------------------------------------------------
  // Carved, and the one place the vault stops being structure and becomes
  // ornament. Concentric mouldings, each catching the light differently.
  const bossR = reach * lerp(0.06, 0.2, bossK)
  const bands = Math.round(lerp(2, 6, bossK))
  behind.push(el('circle', {
    cx: bx + u(5) * light.dx, cy: by + u(7), r: bossR * 1.15, fill: withAlpha(palette.ink, 0.5),
  }))
  for (let i = bands; i >= 1; i--) {
    const t = i / bands
    subject.push(el('circle', {
      cx: bx - light.dx * bossR * (1 - t) * 0.3,
      cy: by - light.dy * bossR * (1 - t) * 0.3,
      r: bossR * t,
      fill: ctx.ramp(lerp(0.35, 0.95, 1 - t)),
    }))
  }

  // Light shafts falling through the vault from an unseen window. Long, soft,
  // and all parallel, which is what sells the single source.
  const shafts = Math.round(lerp(2, 5, liftK))
  const shaftA = Math.atan2(light.dy, light.dx) + Math.PI
  for (let i = 0; i < shafts; i++) {
    const off = (i - (shafts - 1) / 2) * reach * 0.42
    const px = -Math.sin(shaftA) * off
    const py = Math.cos(shaftA) * off
    const wide = reach * skel.range(0.09, 0.2)
    front.push(el('path', {
      d: `M${f(bx + px - Math.sin(shaftA) * wide)} ${f(by + py + Math.cos(shaftA) * wide)}` +
        `L${f(bx + px + Math.cos(shaftA) * springR * 2.4 - Math.sin(shaftA) * wide * 2.6)} ` +
        `${f(by + py + Math.sin(shaftA) * springR * 2.4 + Math.cos(shaftA) * wide * 2.6)}` +
        `L${f(bx + px + Math.cos(shaftA) * springR * 2.4 + Math.sin(shaftA) * wide * 2.6)} ` +
        `${f(by + py + Math.sin(shaftA) * springR * 2.4 - Math.cos(shaftA) * wide * 2.6)}` +
        `L${f(bx + px + Math.sin(shaftA) * wide)} ${f(by + py - Math.cos(shaftA) * wide)}Z`,
      fill: withAlpha(ctx.ramp(1), 0.09),
    }))
  }

  return accent
    ? { back, behind, subject, front, defs, accent }
    : { back, behind, subject, front, defs }
}

export const ribbedVault: Renderer = {
  id: 'ribbed-vault',
  name: 'Ribbed Vault',
  family: 'architectural',
  dark: true,
  focals: ['circle', 'diamond', 'portal'],
  sampler: 'field',
  schema,
  render,
}
