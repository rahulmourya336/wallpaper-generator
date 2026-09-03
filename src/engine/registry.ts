import type { Family, FamilyId, Renderer } from './types'
import { nestedArches } from './renderers/geometric/nested-arches'

/**
 * A new family is a folder plus one entry here. Nothing else in the app knows
 * the list of styles.
 */
export const FAMILIES: readonly Family[] = [
  { id: 'geometric', name: 'Geometric', renderers: [nestedArches] },
]

const RENDERERS = new Map<string, Renderer>()
const FAMILY_OF = new Map<string, FamilyId>()
for (const fam of FAMILIES) {
  for (const r of fam.renderers) {
    RENDERERS.set(r.id, r)
    FAMILY_OF.set(r.id, fam.id)
  }
}

export const DEFAULT_STYLE_ID = 'nested-arches'

export function getRenderer(id: string): Renderer | undefined {
  return RENDERERS.get(id)
}

export function rendererOr(id: string): Renderer {
  return RENDERERS.get(id) ?? (RENDERERS.get(DEFAULT_STYLE_ID) as Renderer)
}

export function getFamily(id: string): Family | undefined {
  return FAMILIES.find((fam) => fam.id === id)
}

export function familyOf(styleId: string): FamilyId {
  return FAMILY_OF.get(styleId) ?? 'geometric'
}

export function allRenderers(): readonly Renderer[] {
  return [...RENDERERS.values()]
}

/**
 * The filmstrip's candidates: siblings within the family first, then the wider
 * catalogue, so the strip stays full while families are still being added.
 */
export function filmstripStyles(styleId: string, count: number): readonly Renderer[] {
  const family = getFamily(familyOf(styleId))
  const siblings = (family?.renderers ?? []).filter((r) => r.id !== styleId)
  const others = allRenderers().filter(
    (r) => r.id !== styleId && !siblings.some((s) => s.id === r.id),
  )
  return [...siblings, ...others].slice(0, count)
}
