import { useEffect, useMemo, useState } from 'react'
import { resolveSize } from '../export/presets'
import type { Variant } from '../engine/variant'
import { actions, useStudio } from '../state/useStudio'
import { CompositionView } from './CompositionView'
import { Lightbox } from './Lightbox'
import { PREVIEW_MAX_SHORT, fitAspect, useDebouncedComposition } from './useComposition'
import { useCandidates } from './useCandidates'
import { useElementSize } from './useElementSize'
import { describeVariant } from './variantLabel'

/**
 * The stage shows candidates, not one answer.
 *
 * Every composition is unique, so the useful question is which one you want,
 * not whether the single generated result happened to land. Three side by side
 * answers that at a glance, and replaces the browse tray that used to sit
 * under the canvas doing the same job less directly.
 *
 * The three are three different ideas — a different category, style, colour and
 * tuning each — because three rolls of one idea only ever answered "which of
 * these near-identical pictures", which is not a question anybody has.
 *
 * This is the desktop arrangement. A phone has neither the width to put three
 * compositions side by side nor the headroom to keep three vector previews
 * live, so it gets its own stage — see MobileStage.
 */

type Size = { width: number; height: number }

function Candidate({
  variant,
  selected,
  onPick,
  index,
  size,
}: {
  variant: Variant
  selected: boolean
  onPick: () => void
  index: number
  size: Size
}): React.JSX.Element {
  const state = useStudio()
  const preset = resolveSize(state.exportPreset)
  const aspect = preset.width / preset.height
  const label = describeVariant(variant)

  const render = useMemo(
    () => fitAspect({ width: preset.width, height: preset.height }, aspect, PREVIEW_MAX_SHORT),
    [preset.width, preset.height, aspect],
  )

  const result = useDebouncedComposition(
    render.width > 1
      ? {
          styleId: variant.styleId,
          seed: variant.seed,
          paletteId: variant.paletteId,
          params: variant.params,
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
    root.style.setProperty('--art-ramp', result.palette.ramp[3] as string)
  }, [selected, result])

  const spoken = `${label.text}, ${label.palette}, seed ${variant.seed}`

  return (
    <button
      type="button"
      className={`cand__btn${selected ? ' is-selected' : ''}`}
      onClick={onPick}
      aria-pressed={selected}
      aria-label={selected ? `${spoken}. Selected.` : `Choose ${spoken}`}
      title={spoken}
      style={{ width: size.width, height: size.height }}
    >
      <span
        className={`cand__frame${result ? '' : ' cand__frame--empty'}`}
        style={result ? { background: result.palette.ground } : undefined}
      >
        {result ? <CompositionView result={result} label={spoken} /> : null}
      </span>
      {/**
       * Named under the picture, always, not on hover.
       *
       * The whole point of three unlike candidates is that the choice is between
       * kinds of thing; a name that only appears once you are already pointing
       * at one arrives after the decision it was meant to inform.
       */}
      <span className="cand__cap">
        <span className="cand__cap-style">{label.style}</span>
        <span className="cand__cap-meta">
          {label.category}
          {label.palette ? <span className="cand__cap-dot" aria-hidden="true" /> : null}
          {label.palette}
        </span>
      </span>
    </button>
  )
}

export function Stage({ onExport }: { onExport?: () => void } = {}): React.JSX.Element {
  const state = useStudio()
  const [rowRef, row] = useElementSize<HTMLDivElement>()
  const candidates = useCandidates()
  const [zoomed, setZoomed] = useState(false)
  const preset = resolveSize(state.exportPreset)
  const aspect = preset.width / preset.height

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
    const n = Math.max(1, candidates.length)
    const each = (row.width - gap * (n - 1)) / n
    // room under each cell for the name, which is outside the button's box
    return fitAspect({ width: each, height: row.height - 34 }, aspect)
  }, [row, aspect, candidates.length])

  return (
    <div className="stage__row" ref={rowRef} style={{ gap }}>
      {cell.width > 1
        ? candidates.map((variant, i) => (
            <Candidate
              key={variant.seed}
              variant={variant}
              index={i}
              size={cell}
              selected={variant.seed === state.seed}
              onPick={() => {
                actions.applyVariant(variant)
                setZoomed(true)
              }}
            />
          ))
        : null}
      <Lightbox
        variants={candidates}
        /**
         * Derived, not stored. A shuffle from inside the full screen view
         * replaces the whole candidate set, and an index held here would be
         * pointing into the old one; reading it back off the selection means
         * there is no second copy of the truth to keep in step.
         */
        index={zoomed ? Math.max(0, candidates.findIndex((v) => v.seed === state.seed)) : -1}
        onIndex={(i) => {
          const variant = candidates[i]
          if (variant) actions.applyVariant(variant)
        }}
        onClose={() => setZoomed(false)}
        onExport={() => onExport?.()}
      />
    </div>
  )
}
