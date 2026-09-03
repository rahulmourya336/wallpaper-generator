export type PaletteMode = 'dark' | 'light'

export type Palette = {
  id: string
  name: string
  mode: PaletteMode
  /** the ground the whole composition sits on. never #000000 or #FFFFFF. */
  ground: string
  /**
   * Five stops ordered by CONTRAST AGAINST THE GROUND, not by luminance:
   * ramp[0] barely separates from the ground, ramp[4] is the strongest
   * structural value. Dark palettes therefore run dark -> light and light
   * palettes run light -> dark, which lets every renderer treat ramp(t) as
   * "how present is this element" without branching on mode.
   */
  ramp: readonly [string, string, string, string, string]
  /** used exactly once per composition */
  accent: string
  /** structural line colour, slightly beyond ramp[0] toward the ground */
  ink: string
}

export const PALETTES: readonly Palette[] = [
  {
    id: 'basalt', name: 'Basalt', mode: 'dark', ground: '#0A0C12',
    ramp: ['#161C2B', '#222B40', '#33405A', '#4B5C78', '#8494B0'],
    accent: '#E3A45F', ink: '#070910',
  },
  {
    id: 'ember', name: 'Ember', mode: 'dark', ground: '#120D0B',
    ramp: ['#1F1814', '#2F241C', '#443327', '#5E4834', '#9A7A5C'],
    accent: '#E86A42', ink: '#0E0A08',
  },
  {
    id: 'verdigris', name: 'Verdigris', mode: 'dark', ground: '#071310',
    ramp: ['#101F1B', '#18302A', '#23443A', '#325C4C', '#5E937C'],
    accent: '#DFC77C', ink: '#050F0D',
  },
  {
    id: 'indigo', name: 'Indigo', mode: 'dark', ground: '#0B0D1C',
    ramp: ['#171B3A', '#222954', '#313A70', '#434E90', '#7480C4'],
    accent: '#F2AEBE', ink: '#080A16',
  },
  {
    id: 'plum', name: 'Plum', mode: 'dark', ground: '#120A14',
    ramp: ['#1F1225', '#2D1B36', '#3F254B', '#553364', '#8A5C9B'],
    accent: '#C9E07A', ink: '#0E0810',
  },
  {
    id: 'graphite', name: 'Graphite', mode: 'dark', ground: '#0D0E10',
    ramp: ['#181B1F', '#25292E', '#373C43', '#4D545D', '#838B96'],
    accent: '#C7452F', ink: '#090A0C',
  },
  {
    id: 'bone', name: 'Bone', mode: 'light', ground: '#EFE9DC',
    ramp: ['#D5CEBE', '#B7AF9C', '#938B78', '#6C6555', '#433E33'],
    accent: '#A8452C', ink: '#2B2822',
  },
  {
    id: 'dune', name: 'Dune', mode: 'light', ground: '#E9DFC9',
    ramp: ['#D2C5A9', '#B4A484', '#8E7E60', '#665A42', '#3F382A'],
    accent: '#2F6E63', ink: '#2A2519',
  },
  {
    id: 'seafog', name: 'Sea Fog', mode: 'light', ground: '#DEE4E3',
    ramp: ['#C3CBCA', '#A2ADAD', '#7C8888', '#576161', '#343B3B'],
    accent: '#B5533F', ink: '#232828',
  },
  {
    id: 'chalk', name: 'Chalk', mode: 'light', ground: '#EAE7E4',
    ramp: ['#CFCAC6', '#AEA8A3', '#877F79', '#5C5551', '#34302D'],
    accent: '#35618C', ink: '#211E1C',
  },
]

const BY_ID = new Map(PALETTES.map((p) => [p.id, p]))

export function getPalette(id: string): Palette | undefined {
  return BY_ID.get(id)
}

export function paletteOr(id: string | undefined, fallback: string): Palette {
  return (id && BY_ID.get(id)) || (BY_ID.get(fallback) as Palette) || (PALETTES[0] as Palette)
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

/** Push a colour toward the ground — for shadows and receding elements. */
export function toward(p: Palette, hex: string, t: number): string {
  return mixHex(hex, p.ground, t)
}
