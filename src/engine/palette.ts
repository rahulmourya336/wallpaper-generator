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
  // --- deep and saturated --------------------------------------------------
  {
    id: 'midnight', name: 'Midnight', mode: 'dark', ground: '#0A1028',
    ramp: ['#1B2450', '#2C3A78', '#4152A4', '#5E70C8', '#93A2E8'],
    accent: '#FF6F4B', ink: '#070B1C',
  },
  {
    id: 'indigo', name: 'Indigo', mode: 'dark', ground: '#0E0B24',
    ramp: ['#221C4E', '#342B78', '#4B3EA6', '#6754CC', '#9C8CEC'],
    accent: '#4FE0B0', ink: '#0A0819',
  },
  {
    id: 'abyss', name: 'Abyss', mode: 'dark', ground: '#03151C',
    ramp: ['#0C2E3C', '#124A5F', '#186A85', '#2090AF', '#4CC4DE'],
    accent: '#FFC94D', ink: '#020F14',
  },
  {
    id: 'verdigris', name: 'Verdigris', mode: 'dark', ground: '#04160F',
    ramp: ['#0E3325', '#14523A', '#1C7452', '#26996C', '#4FC796'],
    accent: '#FFD166', ink: '#030F0A',
  },
  {
    id: 'moss', name: 'Moss', mode: 'dark', ground: '#0C1408',
    ramp: ['#1E3213', '#2C4C1C', '#3E6A27', '#548C36', '#7FBB58'],
    accent: '#FFB03A', ink: '#080E05',
  },
  {
    id: 'wine', name: 'Wine', mode: 'dark', ground: '#1A0611',
    ramp: ['#3A0F27', '#571739', '#7A214F', '#A02F68', '#CF6494'],
    accent: '#FFCE5C', ink: '#12040C',
  },
  {
    id: 'ember', name: 'Ember', mode: 'dark', ground: '#1A0A05',
    ramp: ['#3A1A0C', '#582814', '#7C3A1B', '#A45327', '#D68B4E'],
    accent: '#FFD27D', ink: '#120704',
  },
  {
    id: 'plum', name: 'Plum', mode: 'dark', ground: '#150826',
    ramp: ['#301351', '#48207A', '#6330A4', '#8248C8', '#AF80E6'],
    accent: '#B6F05E', ink: '#0E0519',
  },
  {
    id: 'teal', name: 'Teal', mode: 'dark', ground: '#03181B',
    ramp: ['#0B3439', '#11525A', '#18747E', '#2098A4', '#48C7D2'],
    accent: '#FF8B5E', ink: '#020F11',
  },
  {
    id: 'obsidian', name: 'Obsidian', mode: 'dark', ground: '#0C0C10',
    ramp: ['#1F2029', '#31333F', '#484A5A', '#646779', '#9AA0B4'],
    accent: '#F2504A', ink: '#08080B',
  },
  {
    id: 'rust', name: 'Rust', mode: 'dark', ground: '#180D08',
    ramp: ['#361C10', '#512A18', '#733D21', '#98552E', '#C98B5A'],
    accent: '#57C9B0', ink: '#100804',
  },
  {
    id: 'cobalt', name: 'Cobalt', mode: 'dark', ground: '#04121F',
    ramp: ['#0B2A48', '#11406C', '#175B96', '#2079C0', '#4FA8E4'],
    accent: '#FF9F45', ink: '#030C15',
  },

  // --- mid grounds ---------------------------------------------------------
  {
    id: 'clay', name: 'Clay', mode: 'mid', ground: '#B07A55',
    ramp: ['#9A6544', '#7D4E33', '#5E3826', '#3E241A', '#22140F'],
    accent: '#FFF0D6', ink: '#2A1810',
  },
  {
    id: 'ocean', name: 'Ocean', mode: 'mid', ground: '#1F5E7A',
    ramp: ['#2E7592', '#488FAA', '#6BABC2', '#98C9DA', '#D2EAF2'],
    accent: '#FFC44D', ink: '#12384A',
  },
  {
    id: 'sage', name: 'Sage', mode: 'mid', ground: '#75906B',
    ramp: ['#647E5B', '#4F6748', '#3B4E36', '#283524', '#182015'],
    accent: '#FFF3D2', ink: '#1E2A1A',
  },
  {
    id: 'sunset', name: 'Sunset', mode: 'mid', ground: '#C4553D',
    ramp: ['#AC452F', '#8D3524', '#6B261A', '#481811', '#290D09'],
    accent: '#FFE2AE', ink: '#33120C',
  },

  // --- light ---------------------------------------------------------------
  {
    id: 'paper', name: 'Paper', mode: 'light', ground: '#F5F0E4',
    ramp: ['#DCD3BD', '#BCAE90', '#948567', '#665A42', '#3A3224'],
    accent: '#D6452C', ink: '#2A2418',
  },
  {
    id: 'mist', name: 'Mist', mode: 'light', ground: '#E7EDF1',
    ramp: ['#C9D6DF', '#A3B7C6', '#7893A8', '#4F6A81', '#2C4154'],
    accent: '#E4622F', ink: '#22303C',
  },
  {
    id: 'sand', name: 'Sand', mode: 'light', ground: '#F0E2C6',
    ramp: ['#DCC79E', '#C2A671', '#9E814C', '#725B32', '#453720'],
    accent: '#2E7D6B', ink: '#332813',
  },
  {
    id: 'rose', name: 'Rose', mode: 'light', ground: '#F6E4E1',
    ramp: ['#E9C7C4', '#D49E9F', '#B4737A', '#874E58', '#502A33'],
    accent: '#2F7E70', ink: '#37211F',
  },
  {
    id: 'citron', name: 'Citron', mode: 'light', ground: '#EFF0D6',
    ramp: ['#DBDDAC', '#BFC27C', '#979B52', '#6B6E34', '#3F421D'],
    accent: '#C4442C', ink: '#2A2C14',
  },
  {
    id: 'sherbet', name: 'Sherbet', mode: 'light', ground: '#F8E6D5',
    ramp: ['#F0C8A6', '#E29F72', '#C87546', '#98502C', '#5C2C17'],
    accent: '#1F7A76', ink: '#3B2114',
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

const toLinear = (c: number) => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const toSrgb = (l: number) => {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, s)) * 255)
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0')

/** Gamma-correct mix. sRGB lerping muddies mid-ramp values into grey. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  const m = (p: number, q: number) => toSrgb(toLinear(p) + (toLinear(q) - toLinear(p)) * t)
  return `#${hex2(m(x.r, y.r))}${hex2(m(x.g, y.g))}${hex2(m(x.b, y.b))}`
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
