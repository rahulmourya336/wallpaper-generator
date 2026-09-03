/**
 * Deterministic PRNG. Nothing in engine/ may call Math.random — the whole app
 * depends on (seed, styleId, params, dimensions) reproducing exactly, on every
 * machine, at every sample density.
 */

export type Rng = {
  /** [0, 1) */
  next(): number
  range(a: number, b: number): number
  /** inclusive on both ends */
  int(a: number, b: number): number
  pick<T>(xs: readonly T[]): T
  bool(p?: number): boolean
  /** standard normal, Box-Muller */
  gauss(): number
  /** an independent stream derived from the same seed */
  fork(salt: string): Rng
}

function xmur3(str: string): number {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeRng(seed: string, salt = ''): Rng {
  const source = mulberry32(xmur3(`${seed}:${salt}`))
  let spare: number | null = null

  const rng: Rng = {
    next: source,
    range: (a, b) => a + source() * (b - a),
    int: (a, b) => a + Math.floor(source() * (b - a + 1)),
    pick: <T,>(xs: readonly T[]): T => {
      if (xs.length === 0) throw new Error('rng.pick on empty array')
      return xs[Math.floor(source() * xs.length)] as T
    },
    bool: (p = 0.5) => source() < p,
    gauss: () => {
      if (spare !== null) {
        const v = spare
        spare = null
        return v
      }
      // guard against log(0)
      const u = Math.max(source(), 1e-12)
      const v = source()
      const r = Math.sqrt(-2 * Math.log(u))
      spare = r * Math.sin(2 * Math.PI * v)
      return r * Math.cos(2 * Math.PI * v)
    },
    fork: (childSalt: string) => makeRng(seed, salt ? `${salt}/${childSalt}` : childSalt),
  }
  return rng
}

export const SEED_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
export const SEED_LENGTH = 6

export function isValidSeed(s: string): boolean {
  return s.length === SEED_LENGTH && [...s].every((c) => SEED_ALPHABET.includes(c))
}

/** Derive a fresh seed from an existing deterministic stream. */
export function seedFrom(rng: Rng): string {
  let out = ''
  for (let i = 0; i < SEED_LENGTH; i++) out += SEED_ALPHABET[rng.int(0, 35)]
  return out
}
