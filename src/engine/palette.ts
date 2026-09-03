/**
 * Palettes are the loudest signal a category has. Ten of them, shared by every
 * family, is why the whole catalogue read as one texture in different colours:
 * a starfield and a plaid drawn from the same six greys look like siblings no
 * matter how different the geometry is. Families now draw from their own pools
 * (see `family.ts`), so this list is wide enough to give each of them a voice.
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
   * ramp[0] barely separates from the ground, ramp[4] is the strongest
   * structural value. Dark palettes run dark -> light, light palettes run
   * light -> dark, and mid-ground palettes pick whichever direction carries,
   * which lets every renderer treat ramp(t) as "how present is this element"
   * without ever branching on mode.
   */
  ramp: readonly [string, string, string, string, string]
  /** used exactly once per composition */
  accent: string
  /** structural line colour, slightly beyond ramp[0] toward the ground */
  ink: string
}

export const PALETTES: readonly Palette[] = [
  // --- dark, cool and architectural ---------------------------------------
  {
    id: 'basalt', name: 'Basalt', mode: 'dark', ground: '#0A0C12',
    ramp: ['#1E2637', '#303C55', '#4A5B7C', '#6B7EA3', '#9FB0CB'],
    accent: '#E3A45F', ink: '#070910',
  },
  {
    id: 'graphite', name: 'Graphite', mode: 'dark', ground: '#0D0E10',
    ramp: ['#202327', '#33383E', '#4B525A', '#6A727C', '#9BA3AD'],
    accent: '#C7452F', ink: '#090A0C',
  },
  {
    id: 'indigo', name: 'Indigo', mode: 'dark', ground: '#0B0D1C',
    ramp: ['#232A4E', '#35406F', '#4A5892', '#6472B4', '#98A4D8'],
    accent: '#F2AEBE', ink: '#080A16',
  },
  {
    id: 'slate', name: 'Slate', mode: 'dark', ground: '#0C1116',
    ramp: ['#1B2632', '#2B3B4C', '#405669', '#5D778C', '#90A9BC'],
    accent: '#E7C86A', ink: '#080D11',
  },
  {
    id: 'obsidian', name: 'Obsidian', mode: 'dark', ground: '#0D0B0C',
    ramp: ['#241F22', '#3A3338', '#554C52', '#786D75', '#A79DA4'],
    accent: '#D8524B', ink: '#090708',
  },
  {
    id: 'nocturne', name: 'Nocturne', mode: 'dark', ground: '#06080F',
    ramp: ['#1A2138', '#283358', '#38477B', '#4E60A0', '#8090C8'],
    accent: '#8FD4E8', ink: '#04050A',
  },

  // --- dark, warm ----------------------------------------------------------
  {
    id: 'ember', name: 'Ember', mode: 'dark', ground: '#120D0B',
    ramp: ['#2A2119', '#3F3124', '#5A4433', '#7D6046', '#B08A66'],
    accent: '#E86A42', ink: '#0E0A08',
  },
  {
    id: 'rust', name: 'Rust', mode: 'dark', ground: '#14100D',
    ramp: ['#2C231B', '#423228', '#5E4636', '#82624A', '#B4885F'],
    accent: '#D9743A', ink: '#0F0C0A',
  },
  {
    id: 'tobacco', name: 'Tobacco', mode: 'dark', ground: '#131009',
    ramp: ['#282217', '#3B3222', '#55482F', '#77653F', '#A98F5C'],
    accent: '#E0B354', ink: '#0E0C07',
  },
  {
    id: 'maroon', name: 'Maroon', mode: 'dark', ground: '#150A0D',
    ramp: ['#2C1720', '#43222E', '#5F3140', '#85465A', '#B76B80'],
    accent: '#E8B04A', ink: '#100709',
  },

  // --- dark, green and blue ------------------------------------------------
  {
    id: 'verdigris', name: 'Verdigris', mode: 'dark', ground: '#071310',
    ramp: ['#1B3229', '#27473A', '#35604F', '#487F69', '#74AC92'],
    accent: '#DFC77C', ink: '#050F0D',
  },
  {
    id: 'moss', name: 'Moss', mode: 'dark', ground: '#0B1109',
    ramp: ['#202C1B', '#2F4126', '#405834', '#587548', '#86A96A'],
    accent: '#D3A84E', ink: '#080D07',
  },
  {
    id: 'abyss', name: 'Abyss', mode: 'dark', ground: '#06111A',
    ramp: ['#163046', '#204461', '#2C5C82', '#3D7AA8', '#6BA6CE'],
    accent: '#EFCB68', ink: '#040C13',
  },

  // --- dark, violet --------------------------------------------------------
  {
    id: 'plum', name: 'Plum', mode: 'dark', ground: '#120A14',
    ramp: ['#2E1D38', '#402A4C', '#573A66', '#744E86', '#A57BB8'],
    accent: '#C9E07A', ink: '#0E0810',
  },
  {
    id: 'orchid', name: 'Orchid', mode: 'dark', ground: '#150B1B',
    ramp: ['#2C1737', '#402350', '#56316B', '#74468D', '#A76FC0'],
    accent: '#7BE0C4', ink: '#100813',
  },

  // --- mid grounds: the range the catalogue was missing entirely -----------
  {
    id: 'clay', name: 'Clay', mode: 'mid', ground: '#A08974',
    ramp: ['#8E7A67', '#75634F', '#5A4B3B', '#3D3227', '#241D16'],
    accent: '#F2E4CE', ink: '#2A2219',
  },
  {
    id: 'denim', name: 'Denim', mode: 'mid', ground: '#465A72',
    ramp: ['#57697F', '#6E7F94', '#8B9AAC', '#AEBAC7', '#DCE4EC'],
    accent: '#E8A33D', ink: '#22303F',
  },
  {
    id: 'olive', name: 'Olive', mode: 'mid', ground: '#7C8464',
    ramp: ['#6C7457', '#585F46', '#434936', '#2F3427', '#1E2119'],
    accent: '#F0E0B4', ink: '#22261B',
  },
  {
    id: 'terracotta', name: 'Terracotta', mode: 'mid', ground: '#B0705A',
    ramp: ['#9C614D', '#82503F', '#663E31', '#492C23', '#2C1A15'],
    accent: '#F6E7D2', ink: '#331E18',
  },

  // --- light, neutral ------------------------------------------------------
  {
    id: 'bone', name: 'Bone', mode: 'light', ground: '#EFE9DC',
    ramp: ['#D5CEBE', '#B7AF9C', '#938B78', '#6C6555', '#433E33'],
    accent: '#A8452C', ink: '#2B2822',
  },
  {
    id: 'chalk', name: 'Chalk', mode: 'light', ground: '#EAE7E4',
    ramp: ['#CFCAC6', '#AEA8A3', '#877F79', '#5C5551', '#34302D'],
    accent: '#35618C', ink: '#211E1C',
  },
  {
    id: 'seafog', name: 'Sea Fog', mode: 'light', ground: '#DEE4E3',
    ramp: ['#C3CBCA', '#A2ADAD', '#7C8888', '#576161', '#343B3B'],
    accent: '#B5533F', ink: '#232828',
  },
  {
    id: 'dune', name: 'Dune', mode: 'light', ground: '#E9DFC9',
    ramp: ['#D2C5A9', '#B4A484', '#8E7E60', '#665A42', '#3F382A'],
    accent: '#2F6E63', ink: '#2A2519',
  },

  // --- light, pop: brighter grounds and louder accents for retro work ------
  {
    id: 'sherbet', name: 'Sherbet', mode: 'light', ground: '#F2E5D2',
    ramp: ['#E4CBAE', '#D6A97F', '#C2805A', '#9B5740', '#5E3128'],
    accent: '#2E6F6A', ink: '#3A241C',
  },
  {
    id: 'blush', name: 'Blush', mode: 'light', ground: '#F1E1DE',
    ramp: ['#E1C4C2', '#CB9E9F', '#AE767B', '#834F58', '#4C2C35'],
    accent: '#3F7A6B', ink: '#332023',
  },
  {
    id: 'citron', name: 'Citron', mode: 'light', ground: '#ECEAD3',
    ramp: ['#D9D6AE', '#BEBB83', '#9A985C', '#6F6E3E', '#414127'],
    accent: '#B24A34', ink: '#2A2A19',
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
