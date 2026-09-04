import { useEffect, useState } from 'react'
import { makeRng, seedFrom } from '../engine/rng'
import { useStudio } from '../state/useStudio'

/**
 * The candidate set behind both stages.
 *
 * Desktop lays the three out side by side and the phone stacks them into a
 * swipe deck, but which three they are, and when the set is allowed to change,
 * has to be the same answer in both — otherwise turning a phone sideways would
 * silently swap the alternates you were choosing between.
 */

export const COUNT = 3

/** Alternates derived from the selected seed, so a shared link reproduces the set. */
export function setAround(seed: string): string[] {
  const rng = makeRng(seed, 'alternates')
  return [seed, ...Array.from({ length: COUNT - 1 }, () => seedFrom(rng))]
}

export function useCandidates(): string[] {
  const state = useStudio()
  const [candidates, setCandidates] = useState(() => setAround(state.seed))

  /**
   * Picking a candidate must not reshuffle the others: the one you were
   * comparing against would vanish the moment you chose. So the set is rebuilt
   * only when the selected seed arrives from outside it, which is a shuffle, a
   * restyle, or landing on a link.
   */
  useEffect(() => {
    setCandidates((prev) => (prev.includes(state.seed) ? prev : setAround(state.seed)))
  }, [state.seed])

  return candidates
}
