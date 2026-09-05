import { useEffect, useMemo, useState } from 'react'
import { variantFrom, variantsAround } from '../engine/variant'
import type { Variant } from '../engine/variant'
import { getState, useStudio } from '../state/useStudio'

/**
 * The candidate set behind both stages.
 *
 * Desktop lays the three out side by side and the phone stacks them into a
 * swipe deck, but which three they are, and when the set is allowed to change,
 * has to be the same answer in both — otherwise turning a phone sideways would
 * silently swap the alternates you were choosing between.
 *
 * They are whole designs, not three rolls of one: see engine/variant.
 */

export const COUNT = 3

/** Alternates derived from the selected design, so a shared link reproduces the set. */
export function setAround(anchor: Variant): Variant[] {
  return variantsAround(anchor, COUNT)
}

export function useCandidates(): Variant[] {
  const state = useStudio()
  const [candidates, setCandidates] = useState(() => setAround(variantFrom(state)))

  /**
   * Picking a candidate must not reshuffle the others: the one you were
   * comparing against would vanish the moment you chose. So the set is rebuilt
   * only when the selected seed arrives from outside it, which is a shuffle, a
   * restyle, or landing on a link.
   */
  useEffect(() => {
    setCandidates((prev) =>
      prev.some((v) => v.seed === state.seed) ? prev : setAround(variantFrom(getState())),
    )
  }, [state.seed])

  /**
   * The selected slot mirrors the live state rather than the stored copy.
   *
   * Everything in a candidate is tunable once it is the selection — a slider, a
   * palette, a style swapped from the rail — and the stored set is deliberately
   * frozen. Without this overlay the thumbnail of the design you are editing
   * would be the only one on screen that never changed.
   */
  return useMemo(
    () => candidates.map((v) => (v.seed === state.seed ? variantFrom(state) : v)),
    [candidates, state],
  )
}
