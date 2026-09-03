import type { LayoutId } from './layout'
import type { FamilyId } from './types'

/**
 * What a category feels like.
 *
 * Palettes and composition archetypes used to be global, so a starfield and a
 * a woven cloth were drawn from the same pool of greys in the same arrangement
 * and the ten families read as one. A character gives each family its own colour
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
  /** blurred colour fields behind the artwork */
  atmosphere: number
  /** halo around the single accent */
  bloom: number
  /** broad specular sweep from the light direction */
  sheen: number
}

const DEFAULT: Character = {
  palettes: ['basalt', 'graphite', 'bone'],
  layouts: { centre: 3, low: 2, thirds: 2, macro: 1 },
  vignette: 1,
  grain: 1,
  formFill: 0.72,
  atmosphere: 1,
  bloom: 1,
  sheen: 0.85,
}

export const CHARACTERS: Record<FamilyId, Character> = {
  // cool, built, structural. likes to sit square and get close.
  geometric: {
    palettes: ['midnight','obsidian','cobalt','ember','mist','paper','ocean'],
    layouts: { centre: 3, low: 3, macro: 3, edge: 2, thirds: 3, diagonal: 2 },
    vignette: 1,
    grain: 1,
    formFill: 0.72,
    atmosphere: 0.85,
    bloom: 1,
    sheen: 0.9,
  },
  // earthy and grown. wants a horizon and room above it.
  organic: {
    palettes: ['verdigris','moss','rust','sage','clay','sand','citron'],
    layouts: { horizon: 3, low: 3, thirds: 3, centre: 2, macro: 2 },
    vignette: 0.85,
    grain: 1.15,
    formFill: 0.62,
    atmosphere: 0.9,
    bloom: 0.85,
    sheen: 0.8,
  },
  // loud, flat, printed. bright grounds and pairs of things.
  'retro-pop': {
    palettes: ['sherbet','rose','citron','sunset','wine','plum','clay'],
    layouts: { centre: 2, twin: 3, macro: 3, thirds: 3, edge: 2, diagonal: 2 },
    vignette: 0.5,
    grain: 1.3,
    formFill: 0.82,
    atmosphere: 0.7,
    bloom: 1.2,
    sheen: 0.5,
  },
  // deep and open. almost all sky.
  atmospheric: {
    palettes: ['midnight','indigo','abyss','plum','teal','cobalt'],
    layouts: { low: 3, horizon: 3, centre: 2, macro: 2, edge: 2 },
    vignette: 1.0,
    grain: 0.85,
    formFill: 0.58,
    atmosphere: 1.3,
    bloom: 1.35,
    sheen: 1.2,
  },
  // near monochrome with one signal colour. drawn on a slant.
  technical: {
    palettes: ['obsidian','cobalt','teal','midnight','mist','ocean'],
    layouts: { macro: 3, centre: 2, diagonal: 3, thirds: 3, edge: 2 },
    vignette: 0.9,
    grain: 0.8,
    formFill: 0.58,
    atmosphere: 0.6,
    bloom: 1.35,
    sheen: 0.7,
  },
  // the darkest family, and the only one that goes truly black-and-bright.
  cosmic: {
    palettes: ['indigo','midnight','plum','abyss','wine','obsidian'],
    layouts: { low: 3, centre: 2, macro: 3, edge: 2, twin: 2, horizon: 2 },
    vignette: 1.05,
    grain: 0.9,
    formFill: 0.6,
    atmosphere: 1.35,
    bloom: 1.6,
    sheen: 1,
  },
  // woven and even. no dramatic light, fills the frame edge to edge.
  textile: {
    palettes: ['clay','sunset','sage','ocean','sand','wine','rust'],
    layouts: { centre: 2, macro: 3, diagonal: 3, twin: 2, thirds: 2 },
    vignette: 0.4,
    grain: 1.25,
    formFill: 0.78,
    atmosphere: 0.55,
    bloom: 0.6,
    sheen: 0.45,
  },
  // concrete and daylight. low horizons, subjects pushed to an edge.
  architectural: {
    palettes: ['obsidian','midnight','clay','mist','paper','rust','sage'],
    layouts: { low: 3, thirds: 3, edge: 3, horizon: 2, centre: 2, macro: 2 },
    vignette: 0.95,
    grain: 1.05,
    formFill: 0.68,
    atmosphere: 0.8,
    bloom: 0.85,
    sheen: 1.1,
  },
  // iridescent and wet. close in, or two pools at once.
  liquid: {
    palettes: ['plum','abyss','teal','indigo','cobalt','sunset','rose'],
    layouts: { macro: 3, centre: 2, twin: 3, diagonal: 3, low: 2 },
    vignette: 0.95,
    grain: 0.9,
    formFill: 0.62,
    atmosphere: 1.4,
    bloom: 1.4,
    sheen: 1.05,
  },
  // grown structures, packed. close, and often more than one colony.
  cellular: {
    palettes: ['verdigris','moss','wine','rust','sage','abyss','sand'],
    layouts: { macro: 3, centre: 2, twin: 3, thirds: 3, low: 2 },
    vignette: 0.9,
    grain: 1.1,
    formFill: 0.68,
    atmosphere: 1,
    bloom: 1,
    sheen: 0.75,
  },
}

export function characterOf(family: FamilyId): Character {
  return CHARACTERS[family] ?? DEFAULT
}
