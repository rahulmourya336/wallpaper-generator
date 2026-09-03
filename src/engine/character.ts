import type { LayoutId } from './layout'
import type { FamilyId } from './types'

/**
 * What a category feels like.
 *
 * Palettes and composition archetypes used to be global, so a starfield and a
 * plaid were drawn from the same pool of greys in the same arrangement and
 * the ten families read as one. A character gives each family its own colour
 * pool, its own taste in layouts, and its own handling of the shared finishing
 * passes, which is where the difference between categories actually lives.
 */
export type Character = {
  /** the family's colour pool; the compositor picks within it */
  palettes: readonly string[]
  /** relative weights, unlisted layouts never occur for this family */
  layouts: Partial<Record<LayoutId, number>>
  /** multiplier on the corner darkening */
  vignette: number
  /** multiplier on the grain overlay */
  grain: number
  /** how much of the focal form the compositor fills in behind the field */
  formFill: number
}

const DEFAULT: Character = {
  palettes: ['basalt', 'graphite', 'bone'],
  layouts: { centre: 3, low: 2, thirds: 2, macro: 1 },
  vignette: 1,
  grain: 1,
  formFill: 0.55,
}

export const CHARACTERS: Record<FamilyId, Character> = {
  // cool, built, structural. likes to sit square and get close.
  geometric: {
    palettes: ['basalt', 'slate', 'graphite', 'obsidian', 'ember', 'bone', 'chalk', 'denim'],
    layouts: { centre: 3, low: 3, macro: 3, edge: 2, thirds: 3, diagonal: 2 },
    vignette: 1,
    grain: 1,
    formFill: 0.55,
  },
  // earthy and grown. wants a horizon and room above it.
  organic: {
    palettes: ['verdigris', 'moss', 'tobacco', 'rust', 'olive', 'dune', 'clay', 'bone'],
    layouts: { horizon: 3, low: 3, thirds: 3, centre: 2, macro: 2 },
    vignette: 0.85,
    grain: 1.15,
    formFill: 0.45,
  },
  // loud, flat, printed. bright grounds and pairs of things.
  'retro-pop': {
    palettes: ['sherbet', 'blush', 'citron', 'terracotta', 'dune', 'maroon', 'plum', 'ember'],
    layouts: { centre: 2, twin: 3, macro: 3, thirds: 3, edge: 2, diagonal: 2 },
    vignette: 0.5,
    grain: 1.3,
    formFill: 0.7,
  },
  // deep and open. almost all sky.
  atmospheric: {
    palettes: ['nocturne', 'indigo', 'abyss', 'orchid', 'slate', 'plum'],
    layouts: { low: 3, horizon: 3, centre: 2, macro: 2, edge: 2 },
    vignette: 1.0,
    grain: 0.85,
    formFill: 0.4,
  },
  // near monochrome with one signal colour. drawn on a slant.
  technical: {
    palettes: ['graphite', 'slate', 'nocturne', 'verdigris', 'chalk', 'denim'],
    layouts: { macro: 3, centre: 2, diagonal: 3, thirds: 3, edge: 2 },
    vignette: 0.9,
    grain: 0.8,
    formFill: 0.4,
  },
  // the darkest family, and the only one that goes truly black-and-bright.
  cosmic: {
    palettes: ['nocturne', 'abyss', 'indigo', 'obsidian', 'plum', 'basalt'],
    layouts: { low: 3, centre: 2, macro: 3, edge: 2, twin: 2, horizon: 2 },
    vignette: 1.05,
    grain: 0.9,
    formFill: 0.42,
  },
  // woven and even. no dramatic light, fills the frame edge to edge.
  textile: {
    palettes: ['clay', 'terracotta', 'olive', 'denim', 'dune', 'maroon', 'tobacco', 'bone'],
    layouts: { centre: 2, macro: 3, diagonal: 3, twin: 2, thirds: 2 },
    vignette: 0.4,
    grain: 1.25,
    formFill: 0.65,
  },
  // concrete and daylight. low horizons, subjects pushed to an edge.
  architectural: {
    palettes: ['graphite', 'slate', 'obsidian', 'clay', 'chalk', 'bone', 'rust'],
    layouts: { low: 3, thirds: 3, edge: 3, horizon: 2, centre: 2, macro: 2 },
    vignette: 0.95,
    grain: 1.05,
    formFill: 0.5,
  },
  // iridescent and wet. close in, or two pools at once.
  liquid: {
    palettes: ['orchid', 'abyss', 'indigo', 'plum', 'nocturne', 'terracotta', 'blush'],
    layouts: { macro: 3, centre: 2, twin: 3, diagonal: 3, low: 2 },
    vignette: 0.95,
    grain: 0.9,
    formFill: 0.45,
  },
  // grown structures, packed. close, and often more than one colony.
  cellular: {
    palettes: ['verdigris', 'moss', 'maroon', 'rust', 'olive', 'abyss', 'bone', 'clay'],
    layouts: { macro: 3, centre: 2, twin: 3, thirds: 3, low: 2 },
    vignette: 0.9,
    grain: 1.1,
    formFill: 0.5,
  },
}

export function characterOf(family: FamilyId): Character {
  return CHARACTERS[family] ?? DEFAULT
}
