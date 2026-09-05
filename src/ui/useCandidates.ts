import { useMemo } from 'react'
import { variantFrom, variantsAround } from '../engine/variant'
import type { Variant } from '../engine/variant'
import { useStudio } from '../state/useStudio'
import type { StudioState } from '../state/useStudio'

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

/**
 * The set lives at module scope, not in a component.
 *
 * It used to be `useState` inside this hook, which made it per-component, and
 * the two stages are different components: crossing the mobile breakpoint
 * unmounts one and mounts the other, so a window resize or a phone rotation
 * built a brand new set. Worse, it built it around whichever candidate was
 * *selected* rather than the one the set was originally derived from, so the
 * other two alternates were replaced by an unrelated pair — exactly the thing
 * the note above says must not happen.
 *
 * Deriving it during render rather than from an effect matters for the same
 * reason. An effect runs after the paint, so every seed change — a shuffle, the
 * back button, a pasted link — committed one frame in which the selected design
 * was in no candidate at all: the desktop stage showed nothing selected, and the
 * phone deck fell back to the first slot and animated to it before the real set
 * arrived and moved it again.
 *
 * Rebuilding here is safe because it is idempotent. Once the set contains the
 * selected seed, further calls in the same pass — a second component, or a
 * StrictMode double-invoke — find it and return the same array.
 */
let live: Variant[] = []

function ensure(state: StudioState): Variant[] {
  /**
   * Picking a candidate must not reshuffle the others: the one you were
   * comparing against would vanish the moment you chose. So the set is rebuilt
   * only when the selected seed arrives from outside it, which is a shuffle, a
   * restyle, or landing on a link.
   */
  if (!live.some((v) => v.seed === state.seed)) live = variantsAround(variantFrom(state), COUNT)
  return live
}

export function useCandidates(): Variant[] {
  const state = useStudio()
  const set = ensure(state)

  /**
   * The selected slot mirrors the live state rather than the stored copy.
   *
   * Everything in a candidate is tunable once it is the selection — a slider, a
   * palette, a style swapped from the rail — and the stored set is deliberately
   * frozen. Without this overlay the thumbnail of the design you are editing
   * would be the only one on screen that never changed.
   */
  return useMemo(
    () => set.map((v) => (v.seed === state.seed ? variantFrom(state) : v)),
    [set, state],
  )
}
