import { hexToRgb, mixHex } from '../../palette'
import { clamp, lerp } from '../../svg'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * The one family that beats SVG on Canvas 2D. A stack of blurred ribbons is a
 * Gaussian blur over the whole frame, and feGaussianBlur at 4x export scale is
 * brutally slow to rasterize.
 *
 * Even on canvas the blur is the cost, so the aurora is painted into an
 * offscreen buffer capped at a fixed short edge and scaled up. The compositor
 * still composites its own vignette, sheen and grain over the result as vector.
 *
 * What the marks are
 *
 * An aurora is not a blurred smudge. It is a sheet of light hanging in a fold,
 * seen from underneath: hundreds of near-vertical rays standing side by side,
 * brightest and sharpest along the lower hem where the sheet ends, dissolving
 * upward over hundreds of units into nothing. Painting one wide soft stroke per
 * curtain throws away both scales at once — the fine one (the rays) and the
 * hard one (the hem) — and what is left is an out-of-focus photograph.
 *
 * So a curtain here is built the way the light is: one broad blurred glow for
 * the mass, many thin rays for the grain, and a hem drawn segment by segment so
 * its brightness varies along its own length. Depth comes from drawing the far
 * bands into a half-resolution buffer and blurring that once — distance blurs,
 * not a global bloom — and the hero band is drawn sharp, entering through the
 * top edge and leaving through both sides, too large for the frame to hold.
 *
 * The frame is given a bottom. Curtains that simply fade out at the lower edge
 * have nothing to be behind, and nothing to be behind is what makes them read
 * as wallpaper texture rather than as sky.
 */

const BUFFER_SHORT = 1500

const schema: ParamSchema = [
  { key: 'density', label: 'Curtains', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'turbulence', label: 'Fold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'bloom', label: 'Bloom', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.55 },
  { key: 'stars', label: 'Stars', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'horizon', label: 'Horizon', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'ellipse', 'circle', 'arch'], default: 'auto' },
]

/** A folded sheet of light. Fractions of the frame; the paint pass scales them. */
type Curtain = {
  /** 0 is the hero band at the front, 1 is the farthest one */
  far: number
  /** the hem runs from (ax, ay) to (bx, by); the hero's ends are off-frame */
  ax: number
  bx: number
  ay: number
  by: number
  /** how far the hem bows between its ends */
  sag: number
  /** fbm phase and frequency of the fold, and how deep it cuts */
  phase: number
  folds: number
  fold: number
  /** how far the sheet reaches upward from the hem, in design units */
  tall: number
  rays: number
  /** where along the hem the sheet gathers into its brightest cluster */
  peak: number
  spread: number
  tone: number
  /** how far the hem pushes toward the accent end of the palette */
  warm: number
  /** rays lean toward a zenith off the top of the frame */
  lean: number
}

function render(ctx: RenderContext): Scene {
  const { palette, screenLight } = ctx
  const skel = ctx.fork('skeleton')
  const density = ctx.num('density')
  const turb = ctx.num('turbulence')
  const bloom = ctx.num('bloom')
  const starsK = ctx.num('stars')
  const horizonK = ctx.num('horizon')

  /**
   * The whole composition is decided here rather than inside paint(), because
   * paint runs again on every resize and on export. Anything drawn from a
   * stream consumed at paint time would deal itself a different picture the
   * second time; anything decided here is fixed for the life of the frame.
   */
  const count = Math.round(lerp(3, 5, density))

  // The sheen the compositor lays over this canvas is a screen-space light. The
  // brightest fold belongs under it, or the picture has two suns.
  const litX = clamp(0.5 + 0.5 * screenLight.dx, 0.2, 0.8)

  const curtains: Curtain[] = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 1 : i / (count - 1)
    const far = 1 - t
    const hero = i === count - 1
    // Far bands sit low and short, near the horizon haze; the hero hangs high
    // and runs off both sides. That ordering is what reads as distance.
    const ax = hero ? -0.32 : skel.range(-0.38, 0.12)
    const bx = hero ? 1.32 : ax + skel.range(0.55, 1.05)
    const mid = lerp(0.7, 0.42, t) + skel.range(-0.05, 0.05)
    // A band that runs level across the frame is a horizon. It has to fall.
    const tilt = skel.range(hero ? 0.17 : 0.06, hero ? 0.34 : 0.2) *
      (skel.bool(litX > 0.5 ? 0.8 : 0.2) ? -1 : 1)
    curtains.push({
      far,
      ax,
      bx,
      ay: mid - tilt * 0.5,
      by: mid + tilt * 0.5,
      sag: skel.range(-0.12, 0.06) * (0.4 + turb),
      phase: skel.range(0, 40),
      folds: skel.range(2.2, 4.6),
      fold: lerp(0.02, 0.085, turb) * skel.range(0.7, 1.3),
      tall: lerp(210, 620, t) * skel.range(0.85, 1.15),
      rays: Math.round(lerp(26, 62, t) * skel.range(0.85, 1.15)),
      peak: hero
        ? clamp((litX - ax) / (bx - ax), 0.15, 0.85)
        : clamp((litX - ax) / (bx - ax) + skel.range(-0.3, 0.3), 0.1, 0.9),
      spread: skel.range(0.09, 0.19),
      tone: lerp(0.55, 1, t) * skel.range(0.9, 1),
      warm: hero ? skel.range(0.5, 0.85) : skel.range(0.1, 0.4),
      lean: skel.range(-0.16, 0.16),
    })
  }

  const horizon = lerp(0.76, 0.87, horizonK) + skel.range(-0.015, 0.015)
  const ridgePhase = skel.range(0, 40)
  const ridgeAmp = skel.range(0.7, 1.4)
  const treeSide = skel.bool() ? 1 : -1
  const bandPhases = Array.from({ length: 4 }, () => ({
    x: skel.range(-0.05, 1.05),
    w: skel.range(0.1, 0.26),
    a: skel.range(0.012, 0.026),
  }))

  const paint = (c: CanvasRenderingContext2D, rc: RenderContext): void => {
    const W = rc.w
    const H = rc.h
    const scale = Math.min(1, BUFFER_SHORT / Math.min(W, H))
    const bw = Math.max(2, Math.round(W * scale))
    const bh = Math.max(2, Math.round(H * scale))

    const buf = document.createElement('canvas')
    buf.width = bw
    buf.height = bh
    const b = buf.getContext('2d')
    if (!b) return

    /** design units -> buffer px, the buffer's own u() */
    const uu = (units: number) => (units * Math.min(bw, bh)) / 1000
    const rgba = (hex: string, a: number): string => {
      const q = hexToRgb(hex)
      return `rgba(${q.r},${q.g},${q.b},${clamp(a, 0, 1).toFixed(3)})`
    }
    const hy = bh * horizon

    // ---------------------------------------------------------------- sky ---
    // Ground, then a deepening at the very top only. The old pass laid 0.92 of
    // the ground back over the top two thirds, which killed the one region a
    // night sky has any business being dark in and flattened everything else.
    const deep = mixHex(palette.ground, '#05070C', 0.7)
    b.fillStyle = palette.ground
    b.fillRect(0, 0, bw, bh)

    const cap = b.createLinearGradient(0, 0, 0, bh * 0.52)
    cap.addColorStop(0, rgba(deep, 0.7))
    cap.addColorStop(1, rgba(deep, 0))
    b.fillStyle = cap
    b.fillRect(0, 0, bw, bh * 0.52)

    b.globalCompositeOperation = 'lighter'

    // Airglow: the sky is never black where it meets the ground.
    const glow = b.createLinearGradient(0, hy, 0, hy - bh * 0.34)
    glow.addColorStop(0, rgba(rc.ramp(0.5), 0.06))
    glow.addColorStop(1, rgba(rc.ramp(0.5), 0))
    b.fillStyle = glow
    b.fillRect(0, hy - bh * 0.34, bw, bh * 0.34)

    /**
     * Very faint vertical bands across the whole sky. Isolated curtains read as
     * unrelated smudges; a sky with structure between them reads as one system
     * of light. At four hundredths they are felt rather than seen.
     */
    for (const band of bandPhases) {
      const x = band.x * bw
      const half = band.w * bw
      const g = b.createLinearGradient(x - half, 0, x + half, 0)
      g.addColorStop(0, rgba(rc.ramp(0.6), 0))
      g.addColorStop(0.5, rgba(rc.ramp(0.6), band.a))
      g.addColorStop(1, rgba(rc.ramp(0.6), 0))
      b.fillStyle = g
      b.fillRect(x - half, 0, half * 2, hy)
    }

    // --------------------------------------------------------- the geometry --
    const hemAt = (cu: Curtain, s: number): { x: number; y: number } => {
      // two octaves: the long fold the sheet hangs in, and the kinks in it. One
      // octave alone is a smooth arc, which reads as a drawn line rather than
      // as cloth.
      const wob =
        rc.fbm(cu.phase + s * cu.folds, cu.far * 5.7 + 1.3, 3) * 0.78 +
        rc.fbm(cu.phase * 2.1 + s * cu.folds * 4.3, 5.2, 2) * 0.24
      return {
        x: lerp(cu.ax, cu.bx, s) * bw,
        y: (lerp(cu.ay, cu.by, s) + cu.sag * Math.sin(Math.PI * s) + wob * cu.fold) * bh,
      }
    }
    const tallAt = (cu: Curtain, s: number): number => {
      const k = rc.fbm(cu.phase * 0.7 + 11.3 + s * cu.folds * 0.7, 2.1, 3)
      return uu(cu.tall) * (0.55 + 0.7 * (0.5 + 0.5 * k))
    }
    // brightness along the hem: a broad drift plus one gathered cluster
    const envAt = (cu: Curtain, s: number): number => {
      const d = (s - cu.peak) / cu.spread
      const drift = 0.5 + 0.5 * rc.fbm(cu.phase * 1.7 + s * cu.folds * 1.6, 7.7, 3)
      const ends = clamp(Math.min(s, 1 - s) / 0.14, 0, 1)
      return clamp((0.05 + 0.44 * drift * drift + 0.9 * Math.exp(-d * d)) * ends, 0, 1.3)
    }

    /**
     * How much aurora sits at a point, near enough for the stars to answer to.
     * Stars drawn under an additive curtain stay perfectly crisp through it,
     * which puts the whole sky in front of the light instead of behind it.
     */
    const veil = (x: number, y: number): number => {
      let m = 0
      for (const cu of curtains) {
        const s = (x / bw - cu.ax) / (cu.bx - cu.ax)
        if (s < 0 || s > 1) continue
        const p = hemAt(cu, s)
        const t = tallAt(cu, s)
        const dy = p.y - y
        if (dy < -uu(40) || dy > t) continue
        const v = envAt(cu, s) * Math.exp(-Math.max(0, dy) / (t * 0.5)) * (1 - 0.45 * cu.far)
        if (v > m) m = v
      }
      return clamp(m, 0, 1)
    }

    // -------------------------------------------------------------- stars ---
    /**
     * Two populations, not one sprinkle. The faint one is the sky's texture and
     * is almost subliminal; the bright one is a dozen actual stars with weight,
     * two of them flared. One tone at one size over a uniform scatter is the
     * thing that reads as a dot pattern.
     */
    if (starsK > 0.02) {
      const rng = rc.fork('stars')
      const faint = Math.round(460 * starsK)
      for (let i = 0; i < faint; i++) {
        const x = rng.next() * bw
        const y = rng.next() ** 1.25 * hy
        const m = rng.next()
        const a = (0.14 + 0.22 * m) * (1 - 0.85 * veil(x, y)) * (0.35 + 0.65 * (1 - y / hy))
        if (a < 0.012) continue
        b.fillStyle = rgba(rc.ramp(0.8 + 0.2 * m), a)
        b.beginPath()
        b.arc(x, y, uu(0.5 + 0.7 * m), 0, Math.PI * 2)
        b.fill()
      }

      const bright = Math.round(lerp(12, 30, starsK))
      for (let i = 0; i < bright; i++) {
        const x = rng.next() * bw
        const y = rng.next() ** 1.3 * hy * 0.92
        const m = rng.next() ** 1.6
        const dim = 1 - 0.8 * veil(x, y)
        const a = (0.45 + 0.5 * m) * dim
        if (a < 0.05) continue
        const r = uu(1.3 + 1.8 * m)
        const tone = rc.ramp(0.9 + 0.1 * m)
        const halo = b.createRadialGradient(x, y, 0, x, y, r * 5)
        halo.addColorStop(0, rgba(tone, a * 0.5))
        halo.addColorStop(1, rgba(tone, 0))
        b.fillStyle = halo
        b.fillRect(x - r * 5, y - r * 5, r * 10, r * 10)
        b.fillStyle = rgba(tone, a)
        b.beginPath()
        b.arc(x, y, r, 0, Math.PI * 2)
        b.fill()
        // a couple of them earn a diffraction cross; the rest would be a motif
        if (i < 2 + Math.round(starsK * 2)) {
          b.strokeStyle = rgba(tone, a * 0.55)
          b.lineWidth = uu(0.7)
          const arm = r * rng.range(4.5, 8)
          b.beginPath()
          b.moveTo(x - arm, y)
          b.lineTo(x + arm, y)
          b.moveTo(x, y - arm)
          b.lineTo(x, y + arm)
          b.stroke()
        }
      }
    }

    // ------------------------------------------------------------ curtains ---
    const drawCurtain = (
      g: CanvasRenderingContext2D,
      cu: Curtain,
      q: number,
      rays: ReturnType<RenderContext['fork']>,
    ): void => {
      const steps = 40
      const hot = mixHex(rc.ramp(1), palette.accent, cu.warm)
      const body = rc.ramp(0.6 + 0.35 * cu.tone)
      const high = rc.ramp(0.4 + 0.3 * cu.tone)
      // The mass sits lower on the ramp than the rays standing in it. Painted
      // at the rays' own value it is a fog the rays are lost inside.
      const haze = rc.ramp(0.42 + 0.3 * cu.tone)

      /**
       * The coarse scale: the mass of light the rays stand in.
       *
       * Drawn in sections rather than as one long stroke. One stroke carries
       * one value for its whole length, and a single even glow stretched from
       * edge to edge stops being a curtain hanging in the sky and becomes a
       * lit horizon with something dark below it — the sky divided in two
       * rather than an object in it. In sections the mass gathers where the
       * fold gathers and thins to nothing at the ends.
       */
      const mass = 20
      g.save()
      g.filter = `blur(${(uu(18 + 26 * bloom) * (0.5 + 0.45 * cu.far) * q).toFixed(2)}px)`
      g.lineCap = 'round'
      g.lineJoin = 'round'
      for (let i = 0; i < mass; i++) {
        const s0 = i / mass
        const s1 = (i + 1) / mass
        const env = envAt(cu, (s0 + s1) * 0.5)
        const a = (0.075 + 0.05 * bloom) * (1 - 0.85 * cu.far) * Math.pow(env, 1.5)
        if (a < 0.006) continue
        const p0 = hemAt(cu, s0)
        const p1 = hemAt(cu, s1)
        const t = (tallAt(cu, s0) + tallAt(cu, s1)) * 0.5 * (0.6 + 0.6 * env)
        const y = (p0.y + p1.y) * 0.5
        const gl = g.createLinearGradient(0, (y + t * 0.12) * q, 0, (y - t * 0.8) * q)
        gl.addColorStop(0, rgba(haze, a))
        gl.addColorStop(0.38, rgba(haze, a * 0.5))
        gl.addColorStop(1, rgba(high, 0))
        g.strokeStyle = gl
        g.lineWidth = t * 0.58 * q
        const lean = t * 0.3 * (cu.lean + (cu.peak - s0) * 0.2)
        g.beginPath()
        g.moveTo((p0.x + lean) * q, (p0.y - t * 0.3) * q)
        g.lineTo((p1.x + lean) * q, (p1.y - t * 0.3) * q)
        g.stroke()
      }
      g.restore()

      // --- the fine scale: the rays the sheet is actually made of -----------
      for (let i = 0; i < cu.rays; i++) {
        const s = (i + rays.range(0.05, 0.95)) / cu.rays
        const p = hemAt(cu, s)
        // rays come in bunches; evenly weighted ones read as hatching
        const bunch = 0.5 + 0.5 * rc.fbm(cu.phase * 1.3 + s * cu.folds * 6.5, 13.1, 2)
        const env = envAt(cu, s) * (0.45 + 0.9 * bunch)
        const t = tallAt(cu, s) * rays.range(0.28, 1.05)
        const heavy = rays.next() < 0.14
        const a = (0.02 + 0.3 * env) * (1 - 0.25 * cu.far) * (heavy ? 0.6 : 1) * rays.range(0.45, 1.25)
        if (a < 0.015) continue
        // Scattered feet. Rays that all begin exactly on the hem weld their
        // round caps into one continuous hairline, and that hairline is the
        // wire the band above is drawn to avoid.
        const x0 = p.x + uu(rays.range(-7, 7))
        const y0 = p.y + uu(rays.range(-9, 3))
        const dx = t * (cu.lean + (cu.peak - s) * 0.28)
        const x2 = x0 + dx
        const y2 = y0 - t
        const bend = rc.fbm(cu.phase + s * cu.folds * 3.1 + 21, 4.4, 2) * t * 0.16 * (0.4 + turb)
        const gr = g.createLinearGradient(x0 * q, y0 * q, x2 * q, y2 * q)
        // bottom warm, middle at full value, top dissolving: the colour shift
        // is half of what makes a curtain read as a curtain
        gr.addColorStop(0, rgba(mixHex(hot, body, 0.35), a * 0.85))
        gr.addColorStop(0.09, rgba(body, a))
        gr.addColorStop(0.3, rgba(body, a * 0.3))
        gr.addColorStop(0.58, rgba(high, a * 0.05))
        gr.addColorStop(1, rgba(high, 0))
        g.strokeStyle = gr
        // A floor on the width. The far bands are painted into a half scale
        // buffer, where a one unit ray lands on a third of a pixel and simply
        // is not there — which is how distance turned into fog rather than
        // into softer rays.
        g.lineWidth = Math.max(uu(heavy ? rays.range(3.4, 6.5) : rays.range(0.7, 2.2)) * q, 0.75)
        g.beginPath()
        g.moveTo(x0 * q, y0 * q)
        g.quadraticCurveTo(((x0 + x2) * 0.5 + bend) * q, (y0 - t * 0.5) * q, x2 * q, y2 * q)
        g.stroke()
      }

      /**
       * The hem, and the only near-sharp edge in the sky.
       *
       * It is a band with a defined lower lip and a soft top, not a line. A
       * stroked line is a wire — one width, one value, running the full length
       * of the curtain — and a wire is the single fastest way to say "drawn".
       * The band is built segment by segment so its height and its value both
       * answer to where the sheet gathers.
       */
      const hemBand = (heightU: number, blurU: number, k: number, pw: number, down = false): void => {
        g.save()
        if (blurU > 0) g.filter = `blur(${(uu(blurU) * q).toFixed(2)}px)`
        g.lineCap = 'round'
        g.lineJoin = 'round'
        const dir = down ? -1 : 1
        for (let i = 0; i < steps; i++) {
          const s0 = i / steps
          const s1 = (i + 1) / steps
          const env = envAt(cu, (s0 + s1) * 0.5)
          const a = k * Math.pow(env, pw)
          if (a < 0.02) continue
          const p0 = hemAt(cu, s0)
          const p1 = hemAt(cu, s1)
          const h = uu(heightU) * (0.5 + 0.8 * env)
          const y = (p0.y + p1.y) * 0.5
          const gd = g.createLinearGradient(0, (y + dir * h * 0.08) * q, 0, (y - dir * h) * q)
          gd.addColorStop(0, rgba(down ? body : hot, a))
          gd.addColorStop(0.22, rgba(mixHex(hot, body, 0.55), a * 0.5))
          gd.addColorStop(1, rgba(body, 0))
          g.strokeStyle = gd
          g.lineWidth = h * q
          g.beginPath()
          g.moveTo(p0.x * q, (p0.y - dir * h * 0.42) * q)
          g.lineTo(p1.x * q, (p1.y - dir * h * 0.42) * q)
          g.stroke()
        }
        g.restore()
      }
      // A little light spills below the hem as well. With none at all the hem
      // is a hard division between a lit half of the sky and an unlit one,
      // which the eye reads as a horizon rather than as an edge of cloth.
      hemBand(110, 30, 0.04 * (1 - 0.6 * cu.far), 1.5, true)
      hemBand(46 + 30 * cu.far, 11 + 14 * cu.far, 0.26 * (1 - 0.35 * cu.far), 1.7)
      hemBand(24 + 16 * cu.far, 4 + 6 * cu.far, 0.4 * (1 - 0.4 * cu.far), 2.2)

      // The hero's gathered fold is the one place in the frame allowed to
      // reach the top of the ramp, and it earns it over its own glow.
      if (cu.far < 0.2) {
        g.save()
        g.filter = `blur(${(uu(1.1) * q).toFixed(2)}px)`
        g.lineCap = 'round'
        for (let i = 0; i < steps; i++) {
          const s0 = i / steps
          const s1 = (i + 1) / steps
          const sm = (s0 + s1) * 0.5
          const gate = clamp(1.5 - Math.abs(sm - cu.peak) / cu.spread, 0, 1)
          const a = 0.72 * gate * Math.pow(envAt(cu, sm), 2.6)
          if (a < 0.03) continue
          const p0 = hemAt(cu, s0)
          const p1 = hemAt(cu, s1)
          g.strokeStyle = rgba(mixHex(hot, rc.ramp(1), 0.45), a)
          g.lineWidth = uu(2 + 2.6 * gate) * q
          g.beginPath()
          g.moveTo(p0.x * q, p0.y * q)
          g.lineTo(p1.x * q, p1.y * q)
          g.stroke()
        }
        g.restore()
      }
    }

    /**
     * Distance blurs, a global bloom does not. The far bands go into a half
     * scale buffer that is blurred once on the way back, so they lose detail
     * the way something far away loses it; the hero is drawn straight onto the
     * frame and keeps every ray.
     */
    const backs = curtains.filter((cu) => cu.far >= 0.2)
    if (backs.length > 0) {
      const q = 0.5
      const sc = document.createElement('canvas')
      sc.width = Math.max(2, Math.round(bw * q))
      sc.height = Math.max(2, Math.round(bh * q))
      const s2 = sc.getContext('2d')
      if (s2) {
        s2.globalCompositeOperation = 'lighter'
        const raysFar = rc.fork('rays-far')
        for (const cu of backs) drawCurtain(s2, cu, q, raysFar)
        b.save()
        b.filter = `blur(${uu(3.5).toFixed(2)}px)`
        b.globalAlpha = 0.66
        b.drawImage(sc, 0, 0, sc.width, sc.height, 0, 0, bw, bh)
        b.restore()
      }
    }
    const raysNear = rc.fork('rays-near')
    for (const cu of curtains) {
      if (cu.far < 0.2) drawCurtain(b, cu, 1, raysNear)
    }

    // ------------------------------------------------------------- ground ---
    /**
     * A bottom to the frame. Water first: the sky above the horizon, mirrored
     * and squashed into the lower band so the light has somewhere to land, then
     * broken by ripples so it stops being a mirror. The shore goes over the top
     * of it, which is what puts the curtains behind something.
     */
    b.globalCompositeOperation = 'source-over'
    const refl = document.createElement('canvas')
    refl.width = Math.max(2, Math.round(bw * 0.5))
    refl.height = Math.max(2, Math.round(bh * 0.5))
    const r2 = refl.getContext('2d')
    if (r2) {
      r2.drawImage(buf, 0, 0, bw, bh, 0, 0, refl.width, refl.height)
      const k = 0.34
      b.save()
      b.beginPath()
      b.rect(0, hy, bw, bh - hy)
      b.clip()
      b.filter = `blur(${uu(4).toFixed(2)}px)`
      b.globalAlpha = 0.2 + 0.1 * bloom
      b.translate(0, hy * (1 + k))
      b.scale(1, -k)
      b.drawImage(refl, 0, 0, refl.width, refl.height, 0, 0, bw, bh)
      b.restore()
    }

    // ripples: short broken strokes, denser at the horizon, none full width
    const wr = rc.fork('water')
    const ripples = 34
    for (let i = 0; i < ripples; i++) {
      const t = (i + wr.range(0, 0.8)) / ripples
      const y = hy + (bh - hy) * Math.pow(t, 1.7)
      const x0 = wr.range(-0.15, 0.75) * bw
      const len = wr.range(0.2, 0.8) * bw
      const lightLine = wr.next() < 0.45
      const a = lightLine ? wr.range(0.05, 0.16) * (1 - t) : wr.range(0.12, 0.4)
      b.globalCompositeOperation = lightLine ? 'lighter' : 'source-over'
      b.strokeStyle = rgba(lightLine ? rc.ramp(0.75) : deep, a)
      b.lineWidth = uu(wr.range(0.6, 1.4) + t * 2.6)
      b.lineCap = 'round'
      b.beginPath()
      for (let j = 0; j <= 6; j++) {
        const s = j / 6
        const x = x0 + len * s
        const yy = y + rc.fbm(x / bw * 6 + i * 3.1, t * 4, 2) * uu(1.6) * (0.4 + t)
        if (j === 0) b.moveTo(x, yy)
        else b.lineTo(x, yy)
      }
      b.stroke()
    }
    b.globalCompositeOperation = 'source-over'

    // haze on the waterline, so shore and water never meet on a drawn edge
    const mist = b.createLinearGradient(0, hy - uu(26), 0, hy + uu(34))
    mist.addColorStop(0, rgba(rc.ramp(0.55), 0))
    mist.addColorStop(0.45, rgba(rc.ramp(0.55), 0.1))
    mist.addColorStop(1, rgba(rc.ramp(0.55), 0))
    b.globalCompositeOperation = 'lighter'
    b.fillStyle = mist
    b.fillRect(0, hy - uu(26), bw, uu(60))
    b.globalCompositeOperation = 'source-over'

    // the shore: an fbm ridge, black against the light
    const shore = mixHex(palette.ink, '#04060A', 0.72)
    const ridgeY = (x: number): number => {
      const n = rc.fbm(ridgePhase + (x / bw) * 3.4, 0.7, 4)
      const n2 = rc.fbm(ridgePhase * 0.5 + (x / bw) * 11, 3.3, 2)
      return hy - uu(64 * ridgeAmp) * (0.4 + 0.6 * (0.5 + 0.5 * n)) - uu(9) * n2
    }
    b.fillStyle = shore
    b.beginPath()
    b.moveTo(0, ridgeY(0))
    const cols = 90
    for (let i = 1; i <= cols; i++) b.lineTo((i / cols) * bw, ridgeY((i / cols) * bw))
    // the waterline carries the same wander as the crest; a ruled edge across
    // the full width is the one straight line the eye will not forgive
    for (let i = cols; i >= 0; i--) {
      const x = (i / cols) * bw
      b.lineTo(x, hy + uu(1 + 4 * (0.5 + 0.5 * rc.fbm(ridgePhase * 1.7 + (x / bw) * 5.5, 6.4, 2))))
    }
    b.closePath()
    b.fill()

    /**
     * A treeline on the crest. Thin verticals at the smallest scale in the
     * frame, clumped rather than spaced, so the silhouette has a texture and
     * not just an outline.
     */
    const tr = rc.fork('trees')
    b.strokeStyle = shore
    b.lineCap = 'round'
    let x = -uu(6)
    while (x < bw + uu(6)) {
      const clump = 0.5 + 0.5 * rc.fbm(ridgePhase + (x / bw) * 7.5, 9.1, 2)
      const h = uu(5 + 30 * clump * clump) * tr.range(0.4, 1.3)
      const y = ridgeY(x)
      b.lineWidth = uu(tr.range(0.6, 1.7))
      b.beginPath()
      b.moveTo(x, y + uu(2))
      b.lineTo(x + h * 0.12 * treeSide * tr.range(0, 1), y - h)
      b.stroke()
      x += uu(tr.range(1.6, 7) * (1.5 - clump))
    }

    // the water darkens toward the viewer, which closes the frame at the bottom
    const near = b.createLinearGradient(0, hy, 0, bh)
    near.addColorStop(0, rgba(deep, 0))
    near.addColorStop(1, rgba(deep, 0.42))
    b.fillStyle = near
    b.fillRect(0, hy, bw, bh - hy)

    /**
     * A quiet band at the top, laid over the light rather than under it. The
     * hero still passes through it, but a phone frame needs somewhere the
     * clock can sit and somewhere the eye can rest before it finds the fold.
     */
    const quiet = b.createLinearGradient(0, 0, 0, bh * 0.3)
    quiet.addColorStop(0, rgba(deep, 0.44))
    quiet.addColorStop(1, rgba(deep, 0))
    b.fillStyle = quiet
    b.fillRect(0, 0, bw, bh * 0.3)

    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(buf, 0, 0, bw, bh, 0, 0, W, H)
  }

  /**
   * No vector accent.
   *
   * It used to be a stray arc struck around the focal form, floating in a sky
   * it had no relationship to — the frame's brightest mark belonging to nothing
   * in the picture. The accent colour is now where the light actually is: the
   * hero curtain's hem, mixed into the one edge in the frame that is sharp.
   */
  return { back: [], behind: [], subject: [], front: [], paint }
}

export const auroraMesh: Renderer = {
  id: 'aurora-mesh',
  name: 'Aurora Mesh',
  family: 'atmospheric',
  dark: true,
  focals: ['ellipse', 'circle', 'arch'],
  sampler: 'field',
  mode: 'canvas',
  schema,
  render,
}
