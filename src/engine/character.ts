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
  // light after it has been through something. jewel grounds, hard bright
  // edges, and the highest bloom in the studio — this family IS the highlight.
  prismatic: {
    palettes: ['abyss', 'teal', 'cobalt', 'indigo', 'plum', 'ocean', 'midnight'],
    layouts: { centre: 3, macro: 3, diagonal: 3, thirds: 2, edge: 2, low: 2 },
    vignette: 1.1,
    grain: 0.55,
    formFill: 0.34,
    atmosphere: 1.25,
    bloom: 1.7,
    sheen: 1.25,
  },
  // a city at night. almost nothing is lit, and what is, is very lit.
  nocturne: {
    palettes: ['wine', 'plum', 'indigo', 'midnight', 'abyss', 'teal', 'cobalt'],
    layouts: { low: 3, horizon: 3, thirds: 3, edge: 2, centre: 2, diagonal: 2 },
    vignette: 1.25,
    grain: 0.95,
    formFill: 0.38,
    atmosphere: 1.2,
    bloom: 1.75,
    sheen: 0.55,
  },
  // cut paper. flat colour, hard edges, and depth made only of shadow, so the
  // shared light passes are turned nearly off and the paper tooth turned up.
  papercut: {
    palettes: ['paper', 'sand', 'sherbet', 'rose', 'citron', 'mist', 'clay', 'sage'],
    layouts: { centre: 3, macro: 3, twin: 2, thirds: 3, low: 2, edge: 2 },
    vignette: 0.3,
    grain: 1.45,
    formFill: 0.86,
    atmosphere: 0.4,
    bloom: 0.45,
    sheen: 0.3,
  },
  // brush and paper. the emptiest family, and the only one that treats bare
  // ground as the subject rather than as what is left over.
  ink: {
    palettes: ['paper', 'mist', 'sand', 'rose', 'obsidian', 'midnight'],
    layouts: { thirds: 3, low: 3, horizon: 3, centre: 2, edge: 2 },
    vignette: 0.25,
    grain: 1.5,
    formFill: 0.22,
    atmosphere: 0.35,
    bloom: 0.4,
    sheen: 0.25,
  },
  // stone, cut and polished. banded, veined, and lit flat like a specimen.
  mineral: {
    palettes: ['wine', 'abyss', 'teal', 'plum', 'sand', 'rose', 'ocean', 'rust'],
    layouts: { macro: 3, centre: 3, horizon: 2, twin: 2, thirds: 2, low: 2 },
    vignette: 0.7,
    grain: 1.2,
    formFill: 0.7,
    atmosphere: 0.75,
    bloom: 0.9,
    sheen: 1.15,
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

/**
 * How a category is composed, as distinct from what it draws.
 *
 * Character gave every family its own colours and its own taste in layouts, and
 * it was not enough: forty-three styles still arrived as one roundish mass,
 * centred, on a soft vertical gradient, because every one of them was handed a
 * focal form to aim at and the same finishing passes on the way out. The
 * differences between families were real and all of them were small.
 *
 * A direction is the larger decision underneath that — what a composition in
 * this category IS. There are four, and they disagree about the fundamentals:
 * how much of the frame the subject takes, whether there is a subject at all,
 * whether the ground carries light or is flat colour, and whether the picture
 * is graded like a photograph or printed like a poster. Assigning them by
 * medium is what stops the catalogue reading as one idea with variations.
 */
export type DirectionId = 'quiet' | 'graphic' | 'macro' | 'atmospheric'

export type Direction = {
  /** multiplier band on whatever radius the layout asked for */
  subjectScale: [number, number]
  /** multiplies the family's own layout weights; 0 rules a layout out */
  layoutBias: Partial<Record<LayoutId, number>>
  /** a lit ground, or flat colour with no gradient in it at all */
  ground: 'gradient' | 'flat'
  /**
   * How hard the field empties away from the subject.
   *
   * 0 fills edge to edge, which is what a macro texture wants and what a
   * composed frame must never do; above 1 the ground is mostly bare and the
   * marks cluster, which is the whole point of the quiet direction.
   */
  falloff: number
  /** does the subject drop a shadow onto the field */
  cast: boolean
  /** how often the ghost geometry pass runs at all, 0..1 */
  ghosts: number
  /** scales the shared finishing passes */
  mul: {
    vignette: number
    grain: number
    atmosphere: number
    bloom: number
    sheen: number
    formFill: number
  }
}

export const DIRECTIONS: Record<DirectionId, Direction> = {
  /**
   * Mostly nothing, and one thing worth finding.
   *
   * The subject is small and pushed off-centre or through an edge, and the
   * field thins fast away from it. This is the only direction that treats bare
   * ground as the subject rather than as what is left over, so the finishing
   * passes are nearly all off: a vignette would put a frame around emptiness
   * and make it read as a vignette rather than as space.
   */
  quiet: {
    subjectScale: [0.38, 0.62],
    layoutBias: { thirds: 3, edge: 3, low: 2, horizon: 2, centre: 0.2, macro: 0, twin: 0.5, diagonal: 0.6 },
    ground: 'gradient',
    falloff: 1.7,
    cast: true,
    ghosts: 0,
    mul: { vignette: 0, grain: 0.6, atmosphere: 0.45, bloom: 0.6, sheen: 0.35, formFill: 0.3 },
  },
  /**
   * Printed, not rendered.
   *
   * Flat colour, hard edges, and scale doing the work that light does
   * elsewhere. Every photographic pass is off — no haze, no sheen, no
   * vignette, almost no grain — because each of them is a way of saying "this
   * is a photograph of something", and this direction is saying the opposite.
   */
  graphic: {
    subjectScale: [0.85, 1.3],
    layoutBias: { centre: 2, macro: 2, twin: 2.5, diagonal: 2, edge: 1.5, horizon: 0.4, thirds: 1.2, low: 0.8 },
    ground: 'flat',
    falloff: 0.3,
    cast: false,
    ghosts: 0,
    mul: { vignette: 0, grain: 0.25, atmosphere: 0, bloom: 0.35, sheen: 0, formFill: 1.15 },
  },
  /**
   * Too close to see the whole of anything.
   *
   * The focal form is pushed out to about the size of the frame, so there is no
   * subject to
   * find and no composition in the arranging sense — the texture is the
   * composition. The falloff goes to zero because a macro that thins toward
   * the corners has quietly become a subject again.
   */
  macro: {
    subjectScale: [0.9, 1.15],
    layoutBias: { macro: 4, diagonal: 2, centre: 0.3, twin: 0.3, thirds: 0.2, low: 0.2, horizon: 0.4, edge: 0.3 },
    ground: 'gradient',
    falloff: 0,
    cast: false,
    ghosts: 0,
    mul: { vignette: 0.4, grain: 1.25, atmosphere: 0.4, bloom: 0.6, sheen: 0.7, formFill: 0 },
  },
  /**
   * Depth, and a subject too large to be contained.
   *
   * The one direction that keeps the full light model, pushed further: the
   * subject is big enough that the frame cuts it, which is what stops it
   * reading as an object floating in the middle of a picture.
   */
  atmospheric: {
    subjectScale: [0.95, 1.45],
    layoutBias: { edge: 3, macro: 2.5, low: 2, diagonal: 2, horizon: 1.5, centre: 0.4, thirds: 1, twin: 0.6 },
    ground: 'gradient',
    falloff: 0.95,
    cast: true,
    ghosts: 0.45,
    mul: { vignette: 1.15, grain: 0.9, atmosphere: 1.45, bloom: 1.2, sheen: 1.3, formFill: 0.8 },
  },
}

/**
 * Which direction each category is composed in, chosen by what the medium
 * actually is rather than to spread the four evenly. Stone, cells and liquid
 * are things you get close to; cut paper and printed geometry lie flat; ink and
 * a night sky are mostly empty on purpose.
 *
 * Textile is not macro, though the medium suggests it. Its three styles draw
 * objects — a drape, a bloom, a knot — not a weave, and under macro the gather
 * point a drape hangs from was pushed off the frame and the cloth arrived as
 * one line. A subject that overruns the frame and takes the full light model is
 * what a fold of silk actually wants.
 */
export const FAMILY_DIRECTION: Record<FamilyId, DirectionId> = {
  geometric: 'graphic',
  'retro-pop': 'graphic',
  papercut: 'graphic',
  technical: 'graphic',

  organic: 'quiet',
  cosmic: 'quiet',
  ink: 'quiet',

  liquid: 'macro',
  cellular: 'macro',
  mineral: 'macro',

  atmospheric: 'atmospheric',
  architectural: 'atmospheric',
  textile: 'atmospheric',
  prismatic: 'atmospheric',
  nocturne: 'atmospheric',
}

export function directionOf(family: FamilyId): Direction {
  return DIRECTIONS[FAMILY_DIRECTION[family] ?? 'atmospheric']
}

/**
 * The character a composition is actually built with: the family's own taste,
 * scaled by its direction.
 *
 * Folding the multipliers in here rather than at each call site is what let the
 * whole catalogue move without touching a single renderer — everything
 * downstream already reads these numbers off the character it is given.
 */
export type TunedCharacter = Character & {
  direction: DirectionId
  subjectScale: [number, number]
  ground: Direction['ground']
  falloff: number
  cast: boolean
  ghosts: number
}

const tuned = new Map<FamilyId, TunedCharacter>()

export function characterOf(family: FamilyId): TunedCharacter {
  const hit = tuned.get(family)
  if (hit) return hit

  const base = CHARACTERS[family] ?? DEFAULT
  const id = FAMILY_DIRECTION[family] ?? 'atmospheric'
  const d = DIRECTIONS[id]

  const layouts: Partial<Record<LayoutId, number>> = {}
  for (const [k, weight] of Object.entries(base.layouts) as [LayoutId, number][]) {
    const w = weight * (d.layoutBias[k] ?? 1)
    if (w > 0.01) layouts[k] = w
  }
  // a bias that rules out everything the family liked would leave nothing to
  // pick from, so fall back to the family's own weights rather than to none
  const safeLayouts = Object.keys(layouts).length ? layouts : base.layouts

  const out: TunedCharacter = {
    palettes: base.palettes,
    layouts: safeLayouts,
    vignette: base.vignette * d.mul.vignette,
    grain: base.grain * d.mul.grain,
    formFill: base.formFill * d.mul.formFill,
    atmosphere: base.atmosphere * d.mul.atmosphere,
    bloom: base.bloom * d.mul.bloom,
    sheen: base.sheen * d.mul.sheen,
    direction: id,
    subjectScale: d.subjectScale,
    ground: d.ground,
    falloff: d.falloff,
    cast: d.cast,
    ghosts: d.ghosts,
  }
  tuned.set(family, out)
  return out
}
