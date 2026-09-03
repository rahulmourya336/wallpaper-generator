import { useCallback, useEffect, useRef, useState } from 'react'
import { rendererOr } from '../engine/registry'
import { resolveSize } from '../export/presets'
import { actions, useCanGoBack, useStudio } from '../state/useStudio'
import { CompositionView } from './CompositionView'
import { PREVIEW_MAX_SHORT, fitAspect, useDebouncedComposition } from './useComposition'

/**
 * The full-screen view.
 *
 * A thumbnail three across is enough to choose between compositions and not
 * enough to look at one, which is the thing the app is actually for. This is
 * where a composition gets the whole screen, and where the controls that
 * matter while looking at it — shuffle, undo, lock — are within reach without
 * going back to a strip of stamps.
 *
 * Swiping moves between the candidates and selects as it goes, so the view is
 * also the fastest way to compare them: the alternates are the same three the
 * stage was showing, and arriving at one here is arriving at it everywhere.
 */

/** How far a drag has to travel before it counts as a swipe, in px. */
const SWIPE = 56

function BackIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 5.5 4 10.5l5 5" />
      <path d="M4 10.5h9a6 6 0 0 1 0 12h-2" />
    </svg>
  )
}

function ShuffleIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 7h4l4.5 10H17" />
      <path d="M3 17h4l4.5-10H17" />
      <path d="m15 4 3 3-3 3" />
      <path d="m15 14 3 3-3 3" />
    </svg>
  )
}

function LockIcon({ locked }: { locked: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      {locked ? <path d="M8.5 10.5V7.5a3.5 3.5 0 1 1 7 0v3" /> : <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2" />}
    </svg>
  )
}

function ExportIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </svg>
  )
}

function Frame({ seed, active }: { seed: string; active: boolean }): React.JSX.Element {
  const state = useStudio()
  const preset = resolveSize(state.exportPreset)
  const aspect = preset.width / preset.height
  const render = fitAspect({ width: preset.width, height: preset.height }, aspect, PREVIEW_MAX_SHORT)
  const renderer = rendererOr(state.styleId)

  // The one on screen leads. Its neighbours are composed too, so a swipe
  // arrives at a finished picture rather than a blank frame that fills in.
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
    active ? 40 : 220,
  )

  return (
    <div className="lb__frame" aria-hidden={active ? undefined : true}>
      {result ? (
        <CompositionView
          result={result}
          fit="meet"
          {...(active ? { label: `${renderer.name}, seed ${seed}` } : {})}
        />
      ) : null}
    </div>
  )
}

export function Lightbox({
  seeds,
  index,
  onIndex,
  onClose,
  onExport,
}: {
  seeds: readonly string[]
  /** -1 when closed; otherwise the position of the selected seed */
  index: number
  onIndex: (i: number) => void
  onClose: () => void
  onExport: () => void
}): React.JSX.Element {
  const state = useStudio()
  const canGoBack = useCanGoBack()
  const ref = useRef<HTMLDialogElement | null>(null)
  const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const open = index >= 0

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  const go = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(seeds.length - 1, index + delta))
      if (next === index) return
      // Moving here selects, so what you looked at last is what the rest of
      // the app is on when you close. The index is derived from the selection
      // rather than held here, which is why there is nothing to keep in step
      // when a shuffle replaces the whole set from underneath.
      onIndex(next)
    },
    [index, seeds.length, onIndex],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, go])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* no capture available */
    }
    setDrag({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    setDrag({ ...drag, dx: e.clientX - drag.x, dy: e.clientY - drag.y })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* nothing captured */
    }
    const { dx, dy } = drag
    setDrag(null)
    // A mostly-vertical drag downward is a dismiss, which is what the gesture
    // means everywhere else a full-screen image appears.
    if (Math.abs(dy) > Math.abs(dx) && dy > SWIPE * 1.6) { onClose(); return }
    if (Math.abs(dx) > SWIPE) go(dx < 0 ? 1 : -1)
  }

  const lockLabel = state.seedLocked
    ? 'Style locked. Shuffle re-rolls the settings only. Click to unlock.'
    : 'Style unlocked. Shuffle picks a new style. Click to lock this one.'

  // Follows the finger while dragging, then springs to the next frame.
  const shift = drag ? drag.dx : 0

  return (
    <dialog
      className="lb"
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-label="Wallpaper, full screen"
    >
      {!open ? null : (
        <>
          <div
            className="lb__deck"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              transform: `translateX(calc(${-index * 100}% + ${shift}px))`,
              transition: drag ? 'none' : 'transform 260ms cubic-bezier(.22,.68,.24,1)',
            }}
          >
            {seeds.map((seed, i) => (
              <Frame key={seed} seed={seed} active={i === index} />
            ))}
          </div>

          <button
            type="button"
            className="lb__close"
            onClick={onClose}
            aria-label="Close the full screen view"
          >
            &times;
          </button>

          {seeds.length > 1 ? (
            <div className="lb__dots" aria-hidden="true">
              {seeds.map((seed, i) => (
                <span key={seed} className={i === index ? 'is-on' : ''} />
              ))}
            </div>
          ) : null}

          <div className="pill pill--actions lb__bar">
            <button
              type="button"
              className="pill__btn pill__btn--icon"
              onClick={() => actions.back()}
              disabled={!canGoBack}
              aria-label="Go back to the previous design"
            >
              <BackIcon />
            </button>
            <button
              type="button"
              className="pill__btn pill__btn--primary"
              onClick={() => actions.shuffle()}
            >
              <ShuffleIcon />
              <span>{state.seedLocked ? 'Reshuffle' : 'Shuffle'}</span>
            </button>
            <button
              type="button"
              className={`pill__btn pill__btn--icon${state.seedLocked ? ' is-active' : ''}`}
              onClick={() => actions.toggleLock()}
              aria-pressed={state.seedLocked}
              aria-label={lockLabel}
            >
              <LockIcon locked={state.seedLocked} />
            </button>
            <button
              type="button"
              className="pill__btn pill__btn--icon"
              onClick={() => {
                // Close first: two modal dialogs open at once leaves the
                // export one behind this and untouchable.
                onClose()
                onExport()
              }}
              aria-label="Export this wallpaper"
            >
              <ExportIcon />
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}
