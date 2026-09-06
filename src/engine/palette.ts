import { mixLab } from './oklab'
/**
 * Palettes carry most of what a wallpaper feels like.
 *
 * The previous set was built out of near-neutral greys with one accent, which
 * is safe and completely forgettable: on a phone it reads as grey with a smudge
 * of colour on it. These carry real chroma in the ground, climb to a stop
 * bright enough to actually draw with, and take an accent chosen to sit against
 * the ground rather than politely beside it.
 */

export type PaletteMode = 'dark' | 'light' | 'mid'

export type Palette = {
  id: string
  name: string
  mode: PaletteMode
  /** the ground the whole composition sits on. never #000000 or #FFFFFF. */
  ground: string
  /**
   * Five stops ordered by CONTRAST AGAINST THE GROUND, not by luminance:
   * ramp[0] is the first readable step off the ground and ramp[4] is the
   * strongest structural value. Dark palettes climb, light palettes descend,
   * and mid grounds take whichever direction carries, so every renderer can
   * treat ramp(t) as "how present is this element" without branching on mode.
   */
  ramp: readonly [string, string, string, string, string]
  /** used exactly once per composition, and meant to be seen */
  accent: string
  /** structural line colour, just beyond ramp[0] toward the ground */
  ink: string
}

export const PALETTES: readonly Palette[] = [
  /**
   * Every ramp travels through hue, not just through lightness.
   *
   * The previous set climbed one hue from dark to light — navy, navy, navy,
   * lighter navy — and the result was mud: a monochrome ramp gives a gradient
   * nowhere to go and a glow nothing to be made of. These move through two or
   * three hues on the way up, the way light actually does in a sky or a fire,
   * so a ground gradient, an atmosphere blob and a bloom all become colour
   * against colour without any renderer asking for it. Accents are chosen to
   * continue the journey rather than to contradict it: the glow at the top of
   * the ramp, not a complementary dot dropped on it.
   */

  // --- deep and luminous ---------------------------------------------------
  {
    id: 'midnight', name: 'Midnight', mode: 'dark', ground: '#070C24',
    ramp: ['#17204E', '#2E2D80', '#5B3FA8', '#A24FB8', '#F07A8E'],
    accent: '#FFB56B', ink: '#04071A',
  },
  {
    id: 'indigo', name: 'Indigo', mode: 'dark', ground: '#0B0A22',
    ramp: ['#1F1B55', '#3A2A8C', '#5A3FC4', '#8C5CE6', '#C88CF5'],
    accent: '#FF8FB1', ink: '#070618',
  },
  {
    id: 'abyss', name: 'Abyss', mode: 'dark', ground: '#02121A',
    ramp: ['#06303F', '#0A5468', '#10809A', '#23B4C8', '#7EE8F0'],
    accent: '#FFE08A', ink: '#010C12',
  },
  {
    id: 'verdigris', name: 'Verdigris', mode: 'dark', ground: '#041610',
    ramp: ['#0B3A2C', '#12604A', '#1E8C68', '#45BC86', '#A8ECB0'],
    accent: '#FFF3A0', ink: '#020F0A',
  },
  {
    id: 'moss', name: 'Moss', mode: 'dark', ground: '#0A1207',
    ramp: ['#1C3313', '#33581F', '#5A8530', '#93B84A', '#D9E27A'],
    accent: '#FFD54F', ink: '#060C04',
  },
  {
    id: 'wine', name: 'Wine', mode: 'dark', ground: '#180410',
    ramp: ['#3E0A2C', '#6E1249', '#A31F5E', '#D9466A', '#FF8C78'],
    accent: '#FFD27A', ink: '#10020A',
  },
  {
    id: 'ember', name: 'Ember', mode: 'dark', ground: '#160704',
    ramp: ['#401509', '#7A2510', '#B84318', '#E8702A', '#FFB05A'],
    accent: '#FFF0B0', ink: '#0E0402',
  },
  {
    id: 'plum', name: 'Plum', mode: 'dark', ground: '#120722',
    ramp: ['#2E1152', '#542080', '#8032AE', '#B851C7', '#F08BD0'],
    accent: '#FFD1E8', ink: '#0C0418',
  },
  {
    id: 'teal', name: 'Teal', mode: 'dark', ground: '#02161A',
    ramp: ['#083C42', '#0F6670', '#1A9AA0', '#3ED0C8', '#A8F5E0'],
    accent: '#FFB48A', ink: '#010F12',
  },
  {
    id: 'obsidian', name: 'Obsidian', mode: 'dark', ground: '#0A0A0E',
    ramp: ['#1C1D26', '#2F3142', '#4A4E66', '#737B9C', '#B8C2DE'],
    accent: '#FF5A4A', ink: '#060609',
  },
  {
    id: 'rust', name: 'Rust', mode: 'dark', ground: '#150A06',
    ramp: ['#3E1A0E', '#6E2E14', '#A4501E', '#D5813A', '#F5BE7A'],
    accent: '#5DDCC4', ink: '#0E0603',
  },
  {
    id: 'cobalt', name: 'Cobalt', mode: 'dark', ground: '#03101F',
    ramp: ['#0A2B5E', '#114AA0', '#1F6FD6', '#4A9CF0', '#A6D6FF'],
    accent: '#FFB870', ink: '#020B16',
  },

  // --- rich mid grounds ----------------------------------------------------
  // The old mids were olive, tan and greyed teal, which is to say the three
  // least appealing grounds a wallpaper can have. These are saturated.
  {
    id: 'clay', name: 'Clay', mode: 'mid', ground: '#A84A2B',
    ramp: ['#8E3A1E', '#70290F', '#521B08', '#361004', '#200902'],
    accent: '#FFEBCB', ink: '#2C1008',
  },
  {
    id: 'ocean', name: 'Ocean', mode: 'mid', ground: '#145A8C',
    ramp: ['#2073AA', '#3A92C8', '#62B4E0', '#9AD4F2', '#D8F0FF'],
    accent: '#FFCE5C', ink: '#0C3654',
  },
  {
    id: 'sage', name: 'Jade', mode: 'mid', ground: '#2F7A6A',
    ramp: ['#246557', '#1A4E43', '#12382F', '#0B241E', '#061510'],
    accent: '#FFF0C4', ink: '#0F2E27',
  },
  {
    id: 'sunset', name: 'Sunset', mode: 'mid', ground: '#C93F3A',
    ramp: ['#A82E2E', '#831F2A', '#5C1424', '#390B1A', '#1E0510'],
    accent: '#FFE0A8', ink: '#3A0F12',
  },

  // --- light ---------------------------------------------------------------
  {
    id: 'paper', name: 'Paper', mode: 'light', ground: '#F6F1E6',
    ramp: ['#DCCFB0', '#B9A47E', '#8C7856', '#5A4A36', '#2C241A'],
    accent: '#E0452A', ink: '#2A2418',
  },
  {
    id: 'mist', name: 'Mist', mode: 'light', ground: '#E9EEF3',
    ramp: ['#C5D3E0', '#94AFC8', '#6285A8', '#3D5A80', '#1E3350'],
    accent: '#F06A3A', ink: '#22303C',
  },
  {
    id: 'sand', name: 'Sand', mode: 'light', ground: '#F3E4C4',
    ramp: ['#E2C48E', '#C99A58', '#A0702E', '#6E4A1A', '#3D2A0C'],
    accent: '#1F8C7A', ink: '#332813',
  },
  {
    id: 'rose', name: 'Rose', mode: 'light', ground: '#F9E6E4',
    ramp: ['#F0C4C6', '#DE95A6', '#C0667F', '#8E3F5E', '#522038'],
    accent: '#1E8C7A', ink: '#37211F',
  },
  {
    id: 'citron', name: 'Citron', mode: 'light', ground: '#F2F3D4',
    ramp: ['#DCE09A', '#BCC45E', '#8FA032', '#5E6E1C', '#34400E'],
    accent: '#E0432A', ink: '#2A2C14',
  },
  {
    id: 'sherbet', name: 'Sherbet', mode: 'light', ground: '#FCE9D6',
    ramp: ['#F7C9A8', '#EE9A74', '#DC6A50', '#B04038', '#6E2028'],
    accent: '#1F7E86', ink: '#3B2114',
  },
]

const BY_ID = new Map(PALETTES.map((p) => [p.id, p]))

export function getPalette(id: string): Palette | undefined {
  return BY_ID.get(id)
}

export function paletteOr(id: string | undefined, fallback: string): Palette {
  return (id && BY_ID.get(id)) || (BY_ID.get(fallback) as Palette) || (PALETTES[0] as Palette)
}

/** Mid grounds read as neither light nor dark, and suit both. */
export function suitsMode(p: Palette, wantDark: boolean): boolean {
  return p.mode === 'mid' || p.mode === (wantDark ? 'dark' : 'light')
}

export type Rgb = { r: number; g: number; b: number }

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * Mix two colours perceptually.
 *
 * This was a gamma-correct sRGB mix, which is already better than the naive
 * one and still wrong in the way that matters: sRGB is a display encoding, so
 * a straight line through it desaturates through the middle. Every ramp in the
 * app is stops interpolated between, so that dip was showing up in the
 * mid-tones of all thirty compositions at once. OKLab is a straight line
 * through something the eye agrees with.
 */
export function mixHex(a: string, b: string, t: number): string {
  return mixLab(a, b, t)
}

/** Sample the five-stop ramp continuously. t is clamped to [0, 1]. */
export function rampAt(p: Palette, t: number): string {
  const c = Math.max(0, Math.min(1, t)) * (p.ramp.length - 1)
  const i = Math.min(p.ramp.length - 2, Math.floor(c))
  return mixHex(p.ramp[i] as string, p.ramp[i + 1] as string, c - i)
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`
}

/** Push a colour toward the ground, for shadows and receding elements. */
export function toward(p: Palette, hex: string, t: number): string {
  return mixHex(hex, p.ground, t)
}
