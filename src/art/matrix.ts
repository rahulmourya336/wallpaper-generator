/**
 * The design matrix.
 *
 * `aestheticFusion`, `technicalPhrases`, `lightingDefault` and `uiSafety` are
 * the supplied art direction and are reproduced verbatim, because they are the
 * vocabulary the output is supposed to speak in.
 *
 * Everything else here exists so the engine can write a brief rather than
 * concatenate keywords: subjects give it something to depict, `medium` and
 * `palette` give it a way to describe how, and `value`/`chroma` let it notice
 * when two categories are being blended that contradict each other.
 */

export type Value = 'dark' | 'light' | 'mid'
export type Chroma = 'muted' | 'balanced' | 'vivid'

export type ArtCategory = {
  id: string
  name: string
  aestheticFusion: string
  technicalPhrases: readonly string[]
  lightingDefault: string
  uiSafety: string

  /** candidate scenes; the engine picks and elaborates one */
  subjects: readonly string[]
  /** how the image is made, not what it shows */
  medium: string
  /** colour direction in words, not hex */
  palette: string
  /** the feeling the frame should carry */
  mood: readonly string[]
  /** overall value key, for resolving a blend */
  value: Value
  chroma: Chroma
  /** extra things to steer away from, beyond the shared list */
  avoid: readonly string[]
}

export const CATEGORIES: readonly ArtCategory[] = [
  {
    id: 'minimalist_landscapes',
    name: 'Minimalist Landscapes',
    aestheticFusion: 'Olly Moss + Hiroshi Yoshida',
    technicalPhrases: [
      'layered vector silhouettes',
      'atmospheric haze',
      'pastel gradient sky',
      'flat color palette',
      'wide negative space top third',
    ],
    lightingDefault: 'golden hour glow / diffused daylight',
    uiSafety: 'Clean top 40% with smooth gradient for clock visibility',
    subjects: [
      'a lone pine ridge receding into four bands of valley mist',
      'a still lake held between stepped mountain silhouettes',
      'a single cypress on a terraced hillside above low cloud',
      'a narrow river cutting through folded hills at dusk',
      'a distant volcanic cone behind overlapping foothills',
      'a solitary heron crossing banded wetlands at first light',
    ],
    medium: 'screen-printed vector illustration with visible layer separation',
    palette: 'warm dusk oranges and rose over cool slate blues, five flat values only',
    mood: ['serene', 'expansive', 'quiet'],
    value: 'mid',
    chroma: 'muted',
    avoid: ['photographic texture', 'harsh contrast', 'busy foreground detail'],
  },
  {
    id: 'cyberpunk_futuristic',
    name: 'Futuristic / Cyberpunk',
    aestheticFusion: 'Syd Mead + Vitaly Bulgarov',
    technicalPhrases: [
      'mechanical greeble details',
      'soft neon glow',
      'wet asphalt reflections',
      'raytraced caustics',
      '8k Octane render',
    ],
    lightingDefault: 'split neon (cyan/magenta), ambient occlusion',
    uiSafety: 'Deep dark upper atmosphere with low specular reflection',
    subjects: [
      'a rain-slicked service canyon beneath a megastructure overhang',
      'a lone figure dwarfed by a colossal holographic advertisement',
      'a transit spine threading between monolithic arcology towers',
      'an abandoned loading gantry venting steam into neon fog',
      'a low-slung vehicle at rest on a flooded elevated roadway',
      'a maintenance drone hovering before a wall of stacked machinery',
    ],
    medium: 'cinematic 3D concept render, industrial design realism',
    palette: 'cyan and magenta keys against near-black asphalt, sodium-orange spill',
    mood: ['imposing', 'rain-soaked', 'electric'],
    value: 'dark',
    chroma: 'vivid',
    avoid: ['daylight', 'pastel', 'flat cartoon shading'],
  },
  {
    id: 'dreamy_fantasy',
    name: 'Dreamy / Fantasy',
    aestheticFusion: 'Studio Ghibli + Alphonse Mucha',
    technicalPhrases: [
      'Art Nouveau flowing organic lines',
      'hand-drawn anime watercolor wash',
      'volumetric sunlight',
      'ethereal cloudscapes',
    ],
    lightingDefault: 'god rays, luminous glow',
    uiSafety: 'Soft pastel sky in top third with minimal detail',
    subjects: [
      'a floating island crowned with blossoming trees and trailing vines',
      'a wind-swept meadow beneath towering summer cumulus',
      'a stone archway wreathed in flowering creeper, opening onto light',
      'a heron-like spirit gliding above a valley of tall grass',
      'a hillside shrine half-swallowed by wisteria',
      'a small figure on a ridge watching cloud shadows cross the land',
    ],
    medium: 'hand-painted animation background, watercolour and gouache',
    palette: 'soft cerulean and cream, warm ochre accents, gentle saturation',
    mood: ['wistful', 'warm', 'weightless'],
    value: 'light',
    chroma: 'balanced',
    avoid: ['harsh digital gradients', 'chrome', 'grim tone'],
  },
  {
    id: 'abstract_geometry',
    name: 'Abstract Geometry',
    aestheticFusion: 'Bauhaus + James Turrell',
    technicalPhrases: [
      'light sculpture',
      'biomorphic 3D glass forms',
      'caustic light refractions',
      'frosted glass texture',
      'smooth gradient wash',
    ],
    lightingDefault: 'soft rim lighting, subsurface scattering',
    uiSafety: 'Uncluttered monochrome gradient at top',
    subjects: [
      'a suspended arc of frosted glass above a shallow gradient plane',
      'three interlocking translucent volumes casting coloured caustics',
      'a single torus of milk glass lit from within',
      'a stack of chamfered slabs dissolving into vapour at the edges',
      'a soft-edged aperture opening onto a field of pure colour',
      'a leaning monolith of resin catching a slow rim of light',
    ],
    medium: 'studio product render, physically based materials',
    palette: 'one dominant hue in a long gradient, a single complementary rim',
    mood: ['calm', 'precise', 'weightless'],
    value: 'mid',
    chroma: 'balanced',
    avoid: ['literal objects', 'text', 'visible geometry seams'],
  },
  {
    id: 'oled_dark_mode',
    name: 'Dark / OLED Minimal',
    aestheticFusion: 'Beeple + H.R. Giger (Subtle Elegance)',
    technicalPhrases: [
      'monochromatic dark obsidian tones',
      'glowing bioluminescent accents',
      'deep contrast',
      'minimal specular highlight',
      'true OLED pitch black background #000000',
    ],
    lightingDefault: 'isolated bioluminescent rim light',
    uiSafety: 'Pure black (#000000) top half for maximum battery and widget contrast',
    subjects: [
      'a single bioluminescent frond unfurling out of absolute darkness',
      'an obsidian monolith split by one hairline glowing seam',
      'a ribbed organic form catching one thread of cold light',
      'a slow spiral of luminous filament suspended in void',
      'a fractured shell interior lit from deep inside',
      'a lone deep-sea bloom opening against nothing',
    ],
    medium: 'high-contrast 3D render on pure black, minimal falloff',
    palette: 'pure black ground, one bioluminescent hue, no mid-tones',
    mood: ['still', 'severe', 'luminous'],
    value: 'dark',
    chroma: 'muted',
    avoid: ['grey wash', 'ambient fill light', 'busy background', 'lifted blacks'],
  },
  {
    id: 'vintage_botanical',
    name: 'Vintage Botanical Print',
    aestheticFusion: 'Ernst Haeckel + William Morris',
    technicalPhrases: [
      'lithograph print texture',
      'intricate line art',
      'aged parchment background',
      'pressed floral composition',
    ],
    lightingDefault: 'flat studio lighting, soft vintage warm tone',
    uiSafety: 'Subtle aged paper texture in upper section, leaves framing lower edges',
    subjects: [
      'a specimen plate of fern fronds and seed pods, symmetrically arranged',
      'a climbing rose study with dissected stem details',
      'an ordered arrangement of radiolaria and sea-fan forms',
      'a pressed foxglove spire with root system exposed',
      'a repeating border of acanthus leaves around a central bloom',
      'a study of magnolia in three stages of opening',
    ],
    medium: 'antique lithographic plate, hand-inked linework',
    palette: 'aged cream parchment, sepia ink, muted botanical greens and madder',
    mood: ['scholarly', 'ornate', 'still'],
    value: 'light',
    chroma: 'muted',
    avoid: ['modern gradients', 'neon', 'photographic depth of field'],
  },
]

export function categoryOf(id: string): ArtCategory | undefined {
  return CATEGORIES.find((c) => c.id === id)
}

export function categoryOr(id: string): ArtCategory {
  return categoryOf(id) ?? (CATEGORIES[0] as ArtCategory)
}

/**
 * Phrases that cannot coexist. Blending two categories otherwise produces
 * briefs that ask for a pitch-black background and a pastel sky in the same
 * sentence, which is how prompt engines earn their reputation for word salad.
 */
export const CONFLICTS: ReadonlyArray<readonly [string, string]> = [
  ['true OLED pitch black background #000000', 'pastel gradient sky'],
  ['true OLED pitch black background #000000', 'aged parchment background'],
  ['true OLED pitch black background #000000', 'smooth gradient wash'],
  ['flat color palette', 'raytraced caustics'],
  ['flat color palette', '8k Octane render'],
  ['lithograph print texture', '8k Octane render'],
  ['lithograph print texture', 'soft neon glow'],
  ['aged parchment background', 'wet asphalt reflections'],
  ['hand-drawn anime watercolor wash', '8k Octane render'],
]

export function conflictsWith(phrase: string, chosen: readonly string[]): string | null {
  for (const [a, b] of CONFLICTS) {
    if (phrase === a && chosen.includes(b)) return b
    if (phrase === b && chosen.includes(a)) return a
  }
  return null
}
