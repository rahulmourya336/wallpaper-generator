import { getPalette } from '../engine/palette'
import { getFamily, rendererOr } from '../engine/registry'
import type { Variant } from '../engine/variant'

/**
 * What a candidate is, in words.
 *
 * Once the three on the stage stopped being one style in one colour, the only
 * thing telling you what you were looking at was the crumb in the title bar,
 * which describes the selection and nothing else. Every surface that shows a
 * composition now names it, and they all name it the same way from here.
 */
export type VariantLabel = {
  category: string
  style: string
  palette: string
  /** "Category · Style", for a title or an aria-label */
  text: string
}

export function describeVariant(v: Variant): VariantLabel {
  const category = getFamily(v.categoryId)?.name ?? ''
  const style = rendererOr(v.styleId).name
  const palette = getPalette(v.paletteId)?.name ?? ''
  return { category, style, palette, text: category ? `${category} · ${style}` : style }
}
