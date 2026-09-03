import { makeRng } from '../rng'

/**
 * The film pass: everything that happens to the image after the picture is
 * finished, and nothing that depends on what is in it.
 *
 * Grain is chroma-aware. Luminance-only grain is a grey noise layer, and grey
 * noise over a coloured frame reads as a dirty screen; real film grain is
 * dye clouds in three layers that do not coincide, so the channels have to
 * move independently or it does not look like film.
 *
 * Ordered dithering matters more here than it would in most renderers,
 * because half of what this pipeline produces is large soft gradients — a
 * blurred plane, a bloom falloff, a vignette — and those are exactly where an
 * 8-bit buffer bands. A 4x4 Bayer offset costs one lookup per pixel and
 * removes the banding that the grain would otherwise have to hide.
 *
 * The vignette is anisotropic. A symmetric radial darkening on a 9:16 frame
 * puts its corners much further from the centre than its long edges, so the
 * top and bottom go dark before the sides do; scaling the falloff by aspect
 * keeps the darkening even around the frame.
 */

/** 4x4 Bayer, the smallest ordered matrix that reads as noise rather than as a pattern. */
const BAYER = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map((v) => v / 16 - 0.5)

export type FilmOptions = {
  seed: string
  width: number
  height: number
  /** grain strength, 0..2 */
  grain: number
  /** vignette strength, 0..1.2 */
  vignette: number
  /** where the vignette centres, in pixels */
  cx: number
  cy: number
  /** dust and hairline density, 0..1 */
  dust: number
}

/**
 * Grain, dither and vignette in one pass over the buffer.
 *
 * One pass on purpose: each of these is a couple of arithmetic ops and the
 * expensive part is walking forty-eight million pixels at export size, so
 * three separate passes would cost three times as much for no benefit.
 */
export function applyFilm(data: Uint8ClampedArray, o: FilmOptions): void {
  const { width: w, height: h } = o
  const rng = makeRng(o.seed, 'film')

  // Grain is sampled from a small tile rather than generated per pixel: a
  // fresh random per pixel at 4x export is forty-eight million calls, and the
  // eye cannot tell a 512-cell tile from true noise at grain frequencies.
  const TILE = 512
  const noise = new Float32Array(TILE * 3)
  for (let i = 0; i < TILE * 3; i++) noise[i] = rng.gauss()

  const aspect = w / h
  // the long axis gets a proportionally larger radius, so the darkening is
  // even around the frame instead of eating the short edges first
  const rx = Math.max(o.cx, w - o.cx) * (aspect < 1 ? 1 / aspect : 1) * 0.86
  const ry = Math.max(o.cy, h - o.cy) * (aspect > 1 ? aspect : 1) * 0.86

  const g = o.grain * 9

  let p = 0
  for (let y = 0; y < h; y++) {
    const by = (y & 3) * 4
    const dy = (y - o.cy) / ry
    for (let x = 0; x < w; x++, p += 4) {
      const dx = (x - o.cx) / rx
      const d = dx * dx + dy * dy
      // squared falloff, so the middle of the frame is genuinely untouched
      const vig = 1 - o.vignette * 0.42 * Math.min(1, d * d)

      const dither = BAYER[by + (x & 3)] as number
      // three independent taps into the grain tile: the channels must not
      // coincide or this is a grey veil rather than dye clouds
      const n = (x * 7 + y * 131) % TILE
      const nr = (noise[n] as number) * g
      const ng = (noise[(n + 173) % TILE] as number) * g
      const nb = (noise[(n + 347) % TILE] as number) * g

      data[p] = (data[p] as number) * vig + nr + dither
      data[p + 1] = (data[p + 1] as number) * vig + ng + dither
      data[p + 2] = (data[p + 2] as number) * vig + nb + dither
    }
  }
}

/**
 * Dust and hairlines, drawn rather than filtered.
 *
 * Sparse enough to be found rather than seen: a handful of specks and one or
 * two scratches on a frame. Density any higher and the picture reads as
 * damaged instead of as photographed.
 */
export function drawDust(
  c: CanvasRenderingContext2D,
  o: { seed: string; width: number; height: number; amount: number; unit: number },
): void {
  if (o.amount < 0.02) return
  const rng = makeRng(o.seed, 'dust')
  const specks = Math.round(o.amount * 26)

  c.save()
  c.globalCompositeOperation = 'lighter'
  for (let i = 0; i < specks; i++) {
    const x = rng.range(0, o.width)
    const y = rng.range(0, o.height)
    const r = o.unit * rng.range(0.4, 1.8)
    c.globalAlpha = rng.range(0.05, 0.22)
    c.beginPath()
    c.arc(x, y, r, 0, Math.PI * 2)
    c.fillStyle = '#ffffff'
    c.fill()
  }

  const scratches = rng.int(0, 2)
  for (let i = 0; i < scratches; i++) {
    const x = rng.range(0, o.width)
    const len = o.height * rng.range(0.15, 0.6)
    const y0 = rng.range(-o.height * 0.1, o.height)
    c.globalAlpha = rng.range(0.04, 0.1)
    c.strokeStyle = '#ffffff'
    c.lineWidth = o.unit * rng.range(0.3, 0.8)
    c.beginPath()
    c.moveTo(x, y0)
    c.lineTo(x + rng.range(-o.unit * 6, o.unit * 6), y0 + len)
    c.stroke()
  }
  c.restore()
}
