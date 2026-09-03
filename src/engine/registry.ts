import type { Family, FamilyId, Renderer } from './types'

import { nestedArches } from './renderers/geometric/nested-arches'
import { lowPolyShards } from './renderers/geometric/low-poly-shards'
import { moireInterference } from './renderers/geometric/moire-interference'
import { contourBands } from './renderers/organic/contour-bands'
import { flowField } from './renderers/organic/flow-field'
import { botanicalStems } from './renderers/organic/botanical-stems'
import { ribbonBands } from './renderers/retro-pop/ribbon-bands'
import { terrazzoChips } from './renderers/retro-pop/terrazzo-chips'
import { halftoneSphere } from './renderers/retro-pop/halftone-sphere'
import { auroraMesh } from './renderers/atmospheric/aurora-mesh'
import { particleField } from './renderers/atmospheric/particle-field'
import { circuitTraces } from './renderers/technical/circuit-traces'
import { warpedGrid } from './renderers/technical/warped-grid'
import { eclipseRings } from './renderers/cosmic/eclipse-rings'
import { starfield } from './renderers/cosmic/starfield'
import { orbitalPaths } from './renderers/cosmic/orbital-paths'
import { plainWeave } from './renderers/textile/plain-weave'
import { plaid } from './renderers/textile/plaid'
import { stitchGrid } from './renderers/textile/stitch-grid'
import { isometricBlocks } from './renderers/architectural/isometric-blocks'
import { brutalistStacks } from './renderers/architectural/brutalist-stacks'
import { stairwells } from './renderers/architectural/stairwells'
import { marbledInk } from './renderers/liquid/marbled-ink'
import { oilSlick } from './renderers/liquid/oil-slick'
import { rippleRings } from './renderers/liquid/ripple-rings'
import { circlePacking } from './renderers/cellular/circle-packing'
import { voronoiCells } from './renderers/cellular/voronoi-cells'
import { coralGrowth } from './renderers/cellular/coral-growth'

/**
 * A new family is a folder plus one entry here. Nothing else in the app knows
 * the list of styles.
 */
export const FAMILIES: readonly Family[] = [
  { id: 'geometric', name: 'Geometric', renderers: [nestedArches, lowPolyShards, moireInterference] },
  { id: 'organic', name: 'Organic', renderers: [contourBands, flowField, botanicalStems] },
  { id: 'retro-pop', name: 'Retro Pop', renderers: [ribbonBands, terrazzoChips, halftoneSphere] },
  { id: 'atmospheric', name: 'Atmospheric', renderers: [auroraMesh, particleField] },
  { id: 'technical', name: 'Technical', renderers: [circuitTraces, warpedGrid] },
  { id: 'cosmic', name: 'Cosmic', renderers: [eclipseRings, starfield, orbitalPaths] },
  { id: 'textile', name: 'Textile', renderers: [plainWeave, plaid, stitchGrid] },
  { id: 'architectural', name: 'Architectural', renderers: [isometricBlocks, brutalistStacks, stairwells] },
  { id: 'liquid', name: 'Liquid', renderers: [marbledInk, oilSlick, rippleRings] },
  { id: 'cellular', name: 'Cellular', renderers: [circlePacking, voronoiCells, coralGrowth] },
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
 * catalogue, so the strip stays full for small families.
 */
export function filmstripStyles(styleId: string, count: number): readonly Renderer[] {
  const family = getFamily(familyOf(styleId))
  const siblings = (family?.renderers ?? []).filter((r) => r.id !== styleId)
  const others = allRenderers().filter(
    (r) => r.id !== styleId && !siblings.some((s) => s.id === r.id),
  )
  return [...siblings, ...others].slice(0, count)
}
