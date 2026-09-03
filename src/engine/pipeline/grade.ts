import { labToRgb, rgbToLab } from '../oklab'

/**
 * The grade.
 *
 * Three things, all of them what a colourist would do to a flat digital
 * render. Shadows lift toward cool and highlights roll toward warm, which is
 * the split-tone every photographic process has and no synthetic one does.
 * And the top and bottom two percent are compressed, so nothing in the frame
 * ever reaches pure black or pure white — a composition that clips at either
 * end reads as a screenshot rather than as a print.
 *
 * Done through a 3D lookup table rather than per pixel. An OKLab round trip is
 * two cube roots and two matrix multiplies; at four megapixels that is fine
 * and at the forty-eight megapixels of a 4x export it is not. A 17-cube LUT is
 * 4,913 conversions built once and then trilinearly interpolated, which is
 * three multiplies per pixel and visually indistinguishable — the grade is a
 * smooth function, which is exactly the case a LUT is exact for.
 */

const N = 17
const STEP = 255 / (N - 1)

export type GradeOptions = {
  /** how far shadows go cool and highlights go warm, 0..1 */
  split: number
  /** how hard the ends compress, 0..1 */
  toe: number
  /** overall bias toward warm; a scene graph can ask for one */
  warmth: number
  /** lift the whole frame, for palettes that would otherwise sit too dark */
  lift: number
}

export type Lut = Uint8ClampedArray

/**
 * Build the table. Keyed only on the options, so it is cached across renders
 * and a slider drag never rebuilds it.
 */
export function buildLut(o: GradeOptions): Lut {
  const lut = new Uint8ClampedArray(N * N * N * 3)
  let i = 0
  for (let bi = 0; bi < N; bi++) {
    for (let gi = 0; gi < N; gi++) {
      for (let ri = 0; ri < N; ri++) {
        const lab = rgbToLab(ri * STEP, gi * STEP, bi * STEP)

        // Compress the ends. A smoothstep either side leaves the middle of the
        // range untouched and only pulls the last two percent inward.
        const lo = 0.02 + o.toe * 0.035
        const hi = 1 - (0.02 + o.toe * 0.045)
        let L = lo + lab.L * (hi - lo)
        L = Math.min(1, L + o.lift * 0.05)

        // Split tone. Weight by distance from the middle so mid-tones, where
        // the subject usually lives, keep the hue they were given.
        const shadow = Math.max(0, 1 - L * 2.2) ** 1.5
        const highlight = Math.max(0, L * 2.2 - 1.2) ** 1.5
        const amt = o.split * 0.045

        // cool is -a +? in OKLab terms: negative a is green-cyan, negative b is
        // blue. Warm is the opposite corner.
        const a = lab.a - shadow * amt * 0.35 + highlight * amt * 0.5 + o.warmth * 0.012
        const b = lab.b - shadow * amt * 1.0 + highlight * amt * 0.9 + o.warmth * 0.02

        const out = labToRgb(L, a, b)
        lut[i++] = out.r
        lut[i++] = out.g
        lut[i++] = out.b
      }
    }
  }
  return lut
}

const cache = new Map<string, Lut>()

export function lutFor(o: GradeOptions): Lut {
  const key = `${o.split.toFixed(2)}|${o.toe.toFixed(2)}|${o.warmth.toFixed(2)}|${o.lift.toFixed(2)}`
  const hit = cache.get(key)
  if (hit) return hit
  const lut = buildLut(o)
  cache.set(key, lut)
  if (cache.size > 24) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return lut
}

/** Apply the table to an image buffer in place, trilinearly interpolated. */
export function applyLut(data: Uint8ClampedArray, lut: Lut): void {
  const scale = (N - 1) / 255
  for (let p = 0; p < data.length; p += 4) {
    const r = (data[p] as number) * scale
    const g = (data[p + 1] as number) * scale
    const b = (data[p + 2] as number) * scale

    const r0 = r | 0, g0 = g | 0, b0 = b | 0
    const r1 = r0 + 1 < N ? r0 + 1 : r0
    const g1 = g0 + 1 < N ? g0 + 1 : g0
    const b1 = b0 + 1 < N ? b0 + 1 : b0
    const fr = r - r0, fg = g - g0, fb = b - b0

    // eight corners of the cell, blended on each axis in turn
    const at = (ri: number, gi: number, bi: number) => (bi * N * N + gi * N + ri) * 3

    const c000 = at(r0, g0, b0), c100 = at(r1, g0, b0)
    const c010 = at(r0, g1, b0), c110 = at(r1, g1, b0)
    const c001 = at(r0, g0, b1), c101 = at(r1, g0, b1)
    const c011 = at(r0, g1, b1), c111 = at(r1, g1, b1)

    for (let ch = 0; ch < 3; ch++) {
      const x00 = (lut[c000 + ch] as number) + ((lut[c100 + ch] as number) - (lut[c000 + ch] as number)) * fr
      const x10 = (lut[c010 + ch] as number) + ((lut[c110 + ch] as number) - (lut[c010 + ch] as number)) * fr
      const x01 = (lut[c001 + ch] as number) + ((lut[c101 + ch] as number) - (lut[c001 + ch] as number)) * fr
      const x11 = (lut[c011 + ch] as number) + ((lut[c111 + ch] as number) - (lut[c011 + ch] as number)) * fr
      const y0 = x00 + (x10 - x00) * fg
      const y1 = x01 + (x11 - x01) * fg
      data[p + ch] = y0 + (y1 - y0) * fb
    }
  }
}
