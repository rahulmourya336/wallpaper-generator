import { characterOf } from './character'
import { PALETTES, getPalette, suitsMode } from './palette'
import { makeRng } from './rng'
import type { Renderer } from './types'

/**
 * Which palette a composition ends up on.
 *
 * This lived inside the compositor until the candidate set needed the answer
 * before anything was composed. The three alternates on the stage are chosen so
 * that no two share a colour, and "share a colour" is not a question you can
 * ask while one of them is still holding the word `auto` — the seeded pick has
 * to be resolvable from the outside.
 *
 * Passing a resolved id straight back in as `requested` reproduces the same
 * palette, because a requested id inside the pool always wins. That is what
 * makes it safe for the UI to pin what the seed chose.
 */

/** The pool a style may draw from: its family's character, or everything. */
export function palettePool(renderer: Renderer): readonly string[] {
  const c = characterOf(renderer.family)
  return c.palettes.length ? c.palettes : PALETTES.map((p) => p.id)
}

export function pickPaletteId(
  renderer: Renderer,
  seed: string,
  requested: string | undefined,
  params: Readonly<Record<string, number | string>>,
): string {
  const pool = palettePool(renderer)
  // Same derivation the compositor used, so the pick is unchanged: the palette
  // stream is named, not sequential, and does not care when it is drawn from.
  const rng = makeRng(seed, renderer.id).fork('palette')
  const fromParams = typeof params['palette'] === 'string' ? params['palette'] : undefined
  const preferred = pool.filter((id) => {
    const p = getPalette(id)
    return p ? suitsMode(p, renderer.dark) : false
  })
  if (requested && pool.includes(requested)) return requested
  if (fromParams && pool.includes(fromParams)) return fromParams
  if (preferred.length && rng.bool(0.78)) return rng.pick(preferred)
  return rng.pick(pool)
}
