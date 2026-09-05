import { getPalette, suitsMode } from './palette'
import { palettePool, pickPaletteId } from './palette-pick'
import { FAMILIES, rendererOr } from './registry'
import { makeRng, seedFrom } from './rng'
import type { Rng } from './rng'
import type { PaletteMode } from './palette'
import type { Family, FamilyId, ParamSchema, Renderer } from './types'

/**
 * A candidate is a whole design, not a different roll of the same one.
 *
 * The stage used to show three seeds through one style, one palette and one set
 * of parameters, which meant the three differed only in where the dice landed
 * inside a single idea — the same motif in the same colours three times over.
 * Shuffle was doing all the exploring and the stage was doing none of it.
 *
 * So a candidate carries its own category, style, colour and tuning. Picking one
 * adopts all of it, which is why this is a value the whole app can hold rather
 * than a seed the UI decorates with whatever the studio happens to be set to.
 */
export type Variant = {
  seed: string
  styleId: string
  categoryId: FamilyId
  /** always a concrete id — alternates are chosen so no two share a colour */
  paletteId: string
  params: Record<string, number | string>
}

/**
 * Sample the middle of each range — the extremes are where compositions break.
 *
 * Deterministic in its stream, unlike the crypto-backed roll a shuffle uses, so
 * the same seed rebuilds the same alternate set and a shared link reproduces
 * the whole stage rather than one picture on it.
 */
export function randomizeParams(rng: Rng, schema: ParamSchema): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  for (const spec of schema) {
    if (spec.type === 'range') {
      const span = spec.max - spec.min
      const v = spec.min + span * 0.1 + rng.next() * span * 0.8
      out[spec.key] = Math.round(v / spec.step) * spec.step
    } else {
      out[spec.key] = rng.pick(spec.options)
    }
  }
  return out
}

function modeOf(paletteId: string): PaletteMode | 'unknown' {
  return getPalette(paletteId)?.mode ?? 'unknown'
}

/** A family nobody has had yet, falling back to the whole list. */
function chooseFamily(rng: Rng, used: ReadonlySet<string>): Family {
  const fresh = FAMILIES.filter((f) => !used.has(f.id))
  return rng.pick(fresh.length ? fresh : FAMILIES)
}

function chooseStyle(rng: Rng, family: Family, used: ReadonlySet<string>): Renderer {
  const fresh = family.renderers.filter((r) => !used.has(r.id))
  return rng.pick(fresh.length ? fresh : family.renderers)
}

/**
 * A colour the set has not used, and where possible a different kind of colour.
 *
 * Two dark palettes side by side read as the same wallpaper twice even when the
 * hues are unrelated, because what the eye compares first is how light the
 * ground is. So the strongest constraint is a different value mode; it relaxes
 * to merely a different palette, and then to anything the family allows, rather
 * than failing on a small pool.
 */
function choosePalette(
  rng: Rng,
  renderer: Renderer,
  seed: string,
  usedIds: ReadonlySet<string>,
  usedModes: ReadonlySet<string>,
): string {
  const pool = palettePool(renderer)
  const suited = pool.filter((id) => {
    const p = getPalette(id)
    return p ? suitsMode(p, renderer.dark) : false
  })
  const base = suited.length ? suited : pool
  const distinct = base.filter((id) => !usedIds.has(id) && !usedModes.has(modeOf(id)))
  const unused = base.filter((id) => !usedIds.has(id))
  const from = distinct.length ? distinct : unused.length ? unused : base
  return from.length ? rng.pick(from) : pickPaletteId(renderer, seed, undefined, {})
}

/**
 * Resolve a partial description — typically the live studio state, whose
 * palette may still be `auto` — into a candidate with every field settled.
 */
export function variantFrom(s: {
  seed: string
  styleId: string
  paletteId: string
  params: Record<string, number | string>
}): Variant {
  const renderer = rendererOr(s.styleId)
  return {
    seed: s.seed,
    styleId: renderer.id,
    categoryId: renderer.family,
    paletteId: pickPaletteId(renderer, s.seed, s.paletteId, s.params),
    params: s.params,
  }
}

/**
 * The candidate set: the anchor, then alternates that differ from it and from
 * each other in category, style, colour and tuning.
 *
 * Derived from the anchor's seed rather than rolled fresh, so the set is a
 * property of the design you are looking at: a link reproduces the three
 * choices, not just the one that was made.
 */
export function variantsAround(anchor: Variant, count: number): Variant[] {
  const rng = makeRng(anchor.seed, 'alternates/v2')
  const out: Variant[] = [anchor]

  const families = new Set<string>([anchor.categoryId])
  const styles = new Set<string>([anchor.styleId])
  const palettes = new Set<string>([anchor.paletteId])
  const modes = new Set<string>([modeOf(anchor.paletteId)])

  for (let i = 1; i < count; i++) {
    const family = chooseFamily(rng, families)
    const renderer = chooseStyle(rng, family, styles)
    const seed = seedFrom(rng)
    const paletteId = choosePalette(rng, renderer, seed, palettes, modes)
    // forked by name, so the tuning does not shift with how many draws the
    // choices above happened to take
    const params = randomizeParams(rng.fork(`tune/${i}`), renderer.schema)

    families.add(family.id)
    styles.add(renderer.id)
    palettes.add(paletteId)
    modes.add(modeOf(paletteId))

    out.push({ seed, styleId: renderer.id, categoryId: family.id, paletteId, params })
  }
  return out
}

/** True when two candidates are the same design, not merely the same seed. */
export function sameVariant(a: Variant, b: Variant): boolean {
  return a.seed === b.seed && a.styleId === b.styleId && a.paletteId === b.paletteId
}
