export type AttrValue = string | number | undefined | null | false

/**
 * Coordinate precision, traded against document size.
 *
 * Small numbers are stroke widths and offsets and keep two decimals; anything
 * past a hundred is a position, where a hundredth of a pixel is invisible and
 * the extra digits are pure weight. Across a few hundred thousand numbers that
 * is a measurable slice of the parse cost on every render.
 */
export function f(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const p = Math.abs(n) >= 100 ? 10 : 100
  const r = Math.round(n * p) / p
  return Object.is(r, -0) ? '0' : String(r)
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function attrs(a: Record<string, AttrValue>): string {
  let out = ''
  for (const key in a) {
    const v = a[key]
    if (v === undefined || v === null || v === false) continue
    out += ` ${key}="${typeof v === 'number' ? f(v) : escapeAttr(v)}"`
  }
  return out
}

export function el(tag: string, a: Record<string, AttrValue>, children?: string): string {
  return children === undefined
    ? `<${tag}${attrs(a)}/>`
    : `<${tag}${attrs(a)}>${children}</${tag}>`
}

export function group(a: Record<string, AttrValue>, children: readonly string[]): string {
  return children.length === 0 ? '' : el('g', a, children.join(''))
}

export function path(d: string, a: Record<string, AttrValue> = {}): string {
  return el('path', { d, ...a })
}

/** M/L polyline from flat [x0,y0,x1,y1,...] pairs. */
export function poly(pts: readonly number[], close = false): string {
  if (pts.length < 4) return ''
  let d = `M${f(pts[0] as number)} ${f(pts[1] as number)}`
  for (let i = 2; i < pts.length; i += 2) d += `L${f(pts[i] as number)} ${f(pts[i + 1] as number)}`
  return close ? `${d}Z` : d
}

/** Catmull-Rom through the points, emitted as cubic beziers. */
export function smooth(pts: readonly number[], tension = 0.5): string {
  const n = pts.length / 2
  if (n < 3) return poly(pts)
  const px = (i: number) => pts[Math.max(0, Math.min(n - 1, i)) * 2] as number
  const py = (i: number) => pts[Math.max(0, Math.min(n - 1, i)) * 2 + 1] as number
  let d = `M${f(px(0))} ${f(py(0))}`
  for (let i = 0; i < n - 1; i++) {
    const c1x = px(i) + ((px(i + 1) - px(i - 1)) / 6) * tension * 2
    const c1y = py(i) + ((py(i + 1) - py(i - 1)) / 6) * tension * 2
    const c2x = px(i + 1) - ((px(i + 2) - px(i)) / 6) * tension * 2
    const c2y = py(i + 1) - ((py(i + 2) - py(i)) / 6) * tension * 2
    d += `C${f(c1x)} ${f(c1y)},${f(c2x)} ${f(c2y)},${f(px(i + 1))} ${f(py(i + 1))}`
  }
  return d
}

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${f(cx - rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)}A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)}Z`
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
