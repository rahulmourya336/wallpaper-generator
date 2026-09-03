import type { Rng } from './rng'

/**
 * Seeded 2D gradient noise + fbm. The permutation table is built from the
 * composition's own stream, so two seeds give genuinely different fields
 * rather than the same field sampled at an offset.
 */

const GRAD: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
]

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export type NoiseField = {
  /** [-1, 1] */
  noise2(x: number, y: number): number
  fbm(x: number, y: number, octaves?: number): number
}

export function makeNoise(rng: Rng): NoiseField {
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = rng.int(0, i)
    const t = p[i] as number
    p[i] = p[j] as number
    p[j] = t
  }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255] as number

  function dot(hash: number, x: number, y: number): number {
    const g = GRAD[hash & 7] as readonly [number, number]
    return g[0] * x + g[1] * y
  }

  function noise2(x: number, y: number): number {
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = fade(xf)
    const v = fade(yf)
    const aa = perm[(perm[xi] as number) + yi] as number
    const ab = perm[(perm[xi] as number) + yi + 1] as number
    const ba = perm[(perm[xi + 1] as number) + yi] as number
    const bb = perm[(perm[xi + 1] as number) + yi + 1] as number
    const x1 = lerp(dot(aa, xf, yf), dot(ba, xf - 1, yf), u)
    const x2 = lerp(dot(ab, xf, yf - 1), dot(bb, xf - 1, yf - 1), u)
    return Math.max(-1, Math.min(1, lerp(x1, x2, v) * 1.4))
  }

  function fbm(x: number, y: number, octaves = 4): number {
    let sum = 0
    let amp = 1
    let freq = 1
    let norm = 0
    for (let i = 0; i < octaves; i++) {
      sum += noise2(x * freq, y * freq) * amp
      norm += amp
      amp *= 0.5
      freq *= 2.03
    }
    return norm === 0 ? 0 : sum / norm
  }

  return { noise2, fbm }
}
