import { useEffect, useMemo, useState } from 'react'
import { rendererOr } from '../engine/registry'
import { makeRng, seedFrom } from '../engine/rng'
import { resolveSize } from '../export/presets'
import { actions, useStudio } from '../state/useStudio'
import { CompositionView } from './CompositionView'
import { PREVIEW_MAX_SHORT, fitAspect, useDebouncedComposition } from './useComposition'
import { useElementSize } from './useElementSize'

/**
 * The stage shows candidates, not one answer.
 *
 * Every composition is unique, so the useful question is which one you want,
 * not whether the single generated result happened to land. Three side by side
 * answers that at a glance, and replaces the browse tray that used to sit
 * under the canvas doing the same job less directly.
 */

const COUNT = 3

type Size = { width: number; height: number }

function Candidate({
  seed,
  selected,
  onPick,
  index,
  size,
}: {
  seed: string
  selected: boolean
  onPick: () => void
  index: number
  size: Size
}): React.JSX.Element {
  const state = useStudio()
  const preset = resolveSize(state.exportPreset)
  const renderer = rendererOr(state.styleId)
  const aspect = preset.width / preset.height

  const render = useMemo(
    () => fitAspect({ width: preset.width, height: preset.height }, aspect, PREVIEW_MAX_SHORT),
    [preset.width, preset.height, aspect],
  )

  const result = useDebouncedComposition(
    render.width > 1
      ? {
          styleId: state.styleId,
          seed,
          paletteId: state.paletteId,
          params: state.params,
          width: render.width,
          height: render.height,
        }
      : null,
    // the selected one leads; alternates trail so they never delay it
    selected ? 60 : 160 + index * 70,
  )

  // the chrome borrows its colour from whichever candidate is selected
  useEffect(() => {
    if (!selected || !result) return
    const root = document.documentElement
    root.style.setProperty('--art-accent', result.palette.accent)
    root.style.setProperty('--art-ground', result.palette.ground)
    root.style.setProperty('--art-ramp', result.palette.ramp[3])
  }, [selected, result])

  const label = `${renderer.name}, seed ${seed}`

  return (
    <button
      type="button"
      className={`cand__btn${selected ? ' is-selected' : ''}`}
      onClick={onPick}
      aria-pressed={selected}
      aria-label={selected ? `${label}. Selected.` : `Choose ${label}`}
      style={{ width: size.width, height: size.height }}
    >
      <span
        className={`cand__frame${result ? '' : ' cand__frame--empty'}`}
        style={result ? { background: result.palette.ground } : undefined}
      >
        {result ? <CompositionView result={result} label={label} /> : null}
      </span>
      <span className="cand__seed">{seed}</span>
    </button>
  )
}

/** Alternates derived from the selected seed, so a shared link reproduces the set. */
function setAround(seed: string): string[] {
  const rng = makeRng(seed, 'alternates')
  return [seed, ...Array.from({ length: COUNT - 1 }, () => seedFrom(rng))]
}

export function Stage(): React.JSX.Element {
  const state = useStudio()
  const [rowRef, row] = useElementSize<HTMLDivElement>()
  const [candidates, setCandidates] = useState(() => setAround(state.seed))
  const preset = resolveSize(state.exportPreset)
  const aspect = preset.width / preset.height

  /**
   * Picking a candidate must not reshuffle the others: the one you were
   * comparing against would vanish the moment you chose. So the set is rebuilt
   * only when the selected seed arrives from outside it, which is a shuffle, a
   * restyle, or landing on a link.
   */
  useEffect(() => {
    setCandidates((prev) => (prev.includes(state.seed) ? prev : setAround(state.seed)))
  }, [state.seed])

  /**
   * One size for the whole row, measured once.
   *
   * Letting each cell measure its own box is circular — the box comes from the
   * flex layout, which comes from the cells — and the three came out different
   * heights depending on which resolved first.
   */
  const gap = 20
  const cell = useMemo(() => {
    if (row.width < 2 || row.height < 2) return { width: 0, height: 0 }
    const each = (row.width - gap * (COUNT - 1)) / COUNT
    return fitAspect({ width: each, height: row.height }, aspect)
  }, [row, aspect])

  return (
    <div className="stage__row" ref={rowRef} style={{ gap }}>
      {cell.width > 1
        ? candidates.map((seed, i) => (
            <Candidate
              key={seed}
              seed={seed}
              index={i}
              size={cell}
              selected={seed === state.seed}
              onPick={() => actions.setSeed(seed)}
            />
          ))
        : null}
    </div>
  )
}
