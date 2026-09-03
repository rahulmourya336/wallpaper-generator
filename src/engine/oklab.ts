/**
 * Perceptual colour.
 *
 * Every ramp in the app is a list of hex stops interpolated between, and doing
 * that in sRGB is why a mix of two saturated colours dips through a dead grey
 * in the middle: sRGB is a display encoding, not a perceptual space, so a
 * straight line through it is not a straight line through anything the eye
 * cares about. In OKLab it is, which is the whole reason to pay for the
 * conversion.
 *
 * OKLab rather than OKLCH for the interpolation itself. LCH is the right space
 * to *describe* a colour in — a hue angle is meaningful, a lightness is
 * meaningful — but interpolating a hue angle means deciding which way round
 * the wheel to travel, and for a palette ramp the answer is almost always
 * "neither, go straight". Lab gives that for free. The grade still works in
 * LCH terms, because there the hue rotation is the point.
 */

export type Lab = { L: number; a: number; b: number }
export type Rgb = { r: number; g: number; b: number }

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055

/** 0-255 sRGB to OKLab. */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r / 255)
  const lg = srgbToLinear(g / 255)
  const lb = srgbToLinear(b / 255)

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb

  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)

  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  }
}

/** OKLab to 0-255 sRGB, clamped. */
export function labToRgb(L: number, a: number, b: number): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s

  const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(linearToSrgb(v) * 255)))
  return { r: to255(r), g: to255(g), b: to255(bl) }
}

const HEX = /^#?([0-9a-f]{6})$/i

export function hexToRgb255(hex: string): Rgb {
  const m = HEX.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1] as string, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * Mix two hex colours perceptually.
 *
 * The gamma-correct sRGB mix this replaces was already better than a naive
 * one, but it still travels in a straight line through a space where straight
 * lines desaturate. Two stops of a palette ramp mixed at the halfway point
 * come out at the chroma you would expect from this, and visibly grey from
 * the other.
 */
export function mixLab(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t))
  const A = hexToRgb255(a)
  const B = hexToRgb255(b)
  const la = rgbToLab(A.r, A.g, A.b)
  const lb = rgbToLab(B.r, B.g, B.b)
  const out = labToRgb(
    la.L + (lb.L - la.L) * k,
    la.a + (lb.a - la.a) * k,
    la.b + (lb.b - la.b) * k,
  )
  return rgbToHex(out.r, out.g, out.b)
}

/** Perceptual lightness of a hex colour, 0..1. Used by the critic. */
export function lightnessOf(hex: string): number {
  const { r, g, b } = hexToRgb255(hex)
  return rgbToLab(r, g, b).L
}

/** Chroma of a hex colour. Used by the critic's colour-concentration score. */
export function chromaOf(hex: string): number {
  const { r, g, b } = hexToRgb255(hex)
  const lab = rgbToLab(r, g, b)
  return Math.hypot(lab.a, lab.b)
}
