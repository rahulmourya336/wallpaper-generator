import { el, f, lerp } from '../../svg'
import { hexToRgb, withAlpha } from '../../palette'
import type { ParamSchema, RenderContext, Renderer, Scene } from '../../types'

/**
 * The one family that beats SVG on Canvas 2D. A stack of blurred ribbons is a
 * Gaussian blur over the whole frame, and feGaussianBlur at 4x export scale is
 * brutally slow to rasterize.
 *
 * Even on canvas the blur is the cost, so the aurora is painted into an
 * offscreen buffer capped at a fixed short edge and scaled up. Blur output has
 * no high-frequency detail to lose, so the upscale is invisible and the export
 * costs the same as the preview. The compositor still composites its own
 * vignette and grain over the result as vector.
 */

const BUFFER_SHORT = 1000

const schema: ParamSchema = [
  { key: 'density', label: 'Curtains', type: 'range', min: 0.2, max: 1, step: 0.01, default: 0.55 },
  { key: 'turbulence', label: 'Turbulence', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'falloff', label: 'Falloff', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
  { key: 'bloom', label: 'Bloom', type: 'range', min: 0.1, max: 1, step: 0.01, default: 0.55 },
  { key: 'stars', label: 'Stars', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'form', label: 'Form', type: 'select', options: ['auto', 'ellipse', 'circle', 'arch'], default: 'auto' },
]

function render(ctx: RenderContext): Scene {
  const { u, focal, palette } = ctx
  const skel = ctx.fork('skeleton')
  const starRng = ctx.fork('stars')
  const curtains = Math.round(lerp(5, 16, ctx.num('density')))
  const turb = ctx.num('turbulence')
  const bloom = ctx.num('bloom')
  const starsK = ctx.num('stars')

  // curtain skeletons are drawn here, not inside paint(), so they stay stable
  const shapes = Array.from({ length: curtains }, (_, i) => ({
    x: lerp(-0.15, 1.15, (i + skel.range(0.15, 0.85)) / curtains),
    tone: skel.range(0.35, 1),
    wobble: skel.range(0, Math.PI * 2),
    width: skel.range(0.04, 0.16),
    lean: skel.range(-0.35, 0.35),
    top: skel.range(-0.1, 0.35),
    len: skel.range(0.5, 1.15),
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

    b.fillStyle = palette.ground
    b.fillRect(0, 0, bw, bh)
    b.globalCompositeOperation = 'lighter'

    const uu = (units: number) => (units * Math.min(bw, bh)) / 1000
    const fx = (focal.cx / W) * bw
    const fy = (focal.cy / H) * bh

    for (const s of shapes) {
      const x0 = s.x * bw
      const fall = rc.falloff((s.x * W), focal.cy)
      const rgb = hexToRgb(rc.ramp(0.45 + 0.5 * s.tone * fall))
      const alpha = (0.14 + 0.36 * fall) * (0.45 + 0.55 * s.tone)

      b.save()
      b.filter = `blur(${uu(14 + 46 * bloom)}px)`
      b.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha.toFixed(3)})`
      b.lineWidth = uu(30 + 150 * s.width)
      b.lineCap = 'round'
      b.beginPath()
      const yTop = s.top * bh
      const yBot = yTop + s.len * bh
      const steps = 22
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const y = lerp(yTop, yBot, t)
        const n = rc.fbm(s.wobble + t * 2.4, s.x * 7.3, 3) * turb
        const x = x0 + n * bw * 0.16 + s.lean * t * bw * 0.25
        if (i === 0) b.moveTo(x, y)
        else b.lineTo(x, y)
      }
      b.stroke()
      b.restore()
    }

    // the glow that seats the curtains on the focal centre
    b.filter = 'none'
    const glow = b.createRadialGradient(fx, fy, 0, fx, fy, Math.max(bw, bh) * 0.5)
    const gr = hexToRgb(rc.ramp(0.9))
    glow.addColorStop(0, `rgba(${gr.r},${gr.g},${gr.b},0.17)`)
    glow.addColorStop(1, `rgba(${gr.r},${gr.g},${gr.b},0)`)
    b.fillStyle = glow
    b.fillRect(0, 0, bw, bh)

    // Night sky over the top. Without it the curtains wash the whole frame to
    // an even haze, and the quiet band where the clock sits disappears.
    b.globalCompositeOperation = 'source-over'
    const sky = b.createLinearGradient(0, 0, 0, bh * 0.66)
    const gnd = hexToRgb(palette.ground)
    sky.addColorStop(0, `rgba(${gnd.r},${gnd.g},${gnd.b},0.92)`)
    sky.addColorStop(0.55, `rgba(${gnd.r},${gnd.g},${gnd.b},0.35)`)
    sky.addColorStop(1, `rgba(${gnd.r},${gnd.g},${gnd.b},0)`)
    b.fillStyle = sky
    b.fillRect(0, 0, bw, bh * 0.66)

    // stars, drawn from their own stream so curtain edits never move them
    if (starsK > 0.02) {
      const rng = rc.fork('stars')
      const count = Math.round(220 * starsK)
      b.globalCompositeOperation = 'lighter'
      for (let i = 0; i < count; i++) {
        const x = rng.next() * bw
        const y = rng.next() * bh * 0.75
        const m = rng.next() ** 3
        const rr = uu(0.6 + 3.4 * m)
        const sr = hexToRgb(rc.ramp(0.85 + 0.15 * m))
        b.fillStyle = `rgba(${sr.r},${sr.g},${sr.b},${(0.25 + 0.6 * m).toFixed(3)})`
        b.beginPath()
        b.arc(x, y, rr, 0, Math.PI * 2)
        b.fill()
      }
    }

    b.globalCompositeOperation = 'source-over'
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(buf, 0, 0, bw, bh, 0, 0, W, H)
  }

  // one bright vector element over the canvas: the accent must stay crisp
  const arcR = Math.max(focal.rx, focal.ry) * 1.15
  const a0 = skel.range(Math.PI * 0.9, Math.PI * 1.4)
  const a1 = a0 + skel.range(0.7, 1.5)
  const accent =
    el('path', {
      d: `M${f(focal.cx + Math.cos(a0) * arcR)} ${f(focal.cy + Math.sin(a0) * arcR)}` +
        `A${f(arcR)} ${f(arcR)} 0 0 1 ${f(focal.cx + Math.cos(a1) * arcR)} ${f(focal.cy + Math.sin(a1) * arcR)}`,
      fill: 'none', stroke: palette.accent, 'stroke-width': u(3), 'stroke-linecap': 'round',
    }) +
    el('path', {
      d: `M${f(focal.cx + Math.cos(a0) * (arcR + u(7)))} ${f(focal.cy + Math.sin(a0) * (arcR + u(7)))}` +
        `A${f(arcR + u(7))} ${f(arcR + u(7))} 0 0 1 ${f(focal.cx + Math.cos(a1) * (arcR + u(7)))} ${f(focal.cy + Math.sin(a1) * (arcR + u(7)))}`,
      fill: 'none', stroke: withAlpha(palette.accent, 0.35), 'stroke-width': u(1.2),
    })

  void starRng
  return { back: [], behind: [], subject: [], front: [], accent, paint }
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
