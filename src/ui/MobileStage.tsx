import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { rendererOr } from '../engine/registry'
import { resolveSize } from '../export/presets'
import { actions, useStudio } from '../state/useStudio'
import { CompositionView } from './CompositionView'
import { fitAspect, paramsKey, useDebouncedComposition, useRasterShortEdge } from './useComposition'
import { useCandidates } from './useCandidates'
import { useElementSize } from './useElementSize'

/**
 * The phone stage.
 *
 * A phone is the shape of the thing being made, so it shows one composition at
 * the size it will actually be used at rather than three stamps a thumb cannot
 * judge. The alternates are still there — they are a swipe away, in the same
 * order, and arriving at one here is arriving at it everywhere.
 *
 * Nothing in here animates a property that costs layout. The deck slides on a
 * transform, the sheet lifts it on a transform, and the compositions inside are
 * single bitmaps, so a drag is the compositor moving three boxes and nothing
 * else. That is the whole difference between this and the version it replaces:
 * the old one asked the browser to re-lay-out several thousand SVG nodes on
 * every frame of every gesture.
 */

/** How far a drag has to travel before it counts as a swipe, in px. */
const SWIPE = 52
/** Past this, a gesture has declared itself horizontal or vertical. */
const AXIS_LOCK = 10

/**
 * True once the browser has had a moment with nothing else to do.
 *
 * Re-arms whenever `key` changes, so it gates every round of work rather than
 * only the first. The timeout is the guarantee: a page that never goes idle
 * still gets its alternates, just late.
 */
function useIdle(key: string): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    setIdle(false)
    const ric = window.requestIdleCallback
    if (!ric) {
      const t = window.setTimeout(() => setIdle(true), 400)
      return () => window.clearTimeout(t)
    }
    const id = ric(() => setIdle(true), { timeout: 2000 })
    return () => window.cancelIdleCallback(id)
  }, [key])
  return idle
}

function Frame({
  seed,
  active,
  index,
  label,
}: {
  seed: string
  active: boolean
  index: number
  label: string
}): React.JSX.Element {
  const state = useStudio()
  const preset = resolveSize(state.exportPreset)
  const aspect = preset.width / preset.height
  const short = useRasterShortEdge(aspect, !!rendererOr(state.styleId).build)
  const render = useMemo(
    () => fitAspect({ width: preset.width, height: preset.height }, aspect, short),
    [preset.width, preset.height, aspect, short],
  )

  /**
   * The one on screen leads, and the alternates wait for a gap.
   *
   * They are composed at all so that a swipe arrives at a finished picture
   * rather than a blank frame that fills in — but they are off screen, so
   * nothing about them is worth a millisecond of a main thread that still owes
   * the user a first paint and a responsive control. On the default style each
   * one is a couple of hundred milliseconds of per-pixel work; three of those
   * back to back on load is the difference between an app that opens and an app
   * that hangs.
   */
  const idle = useIdle(`${state.styleId}|${state.paletteId}|${paramsKey(state.params)}`)

  const result = useDebouncedComposition(
    render.width > 1 && (active || idle)
      ? {
          styleId: state.styleId,
          seed,
          paletteId: state.paletteId,
          params: state.params,
          width: render.width,
          height: render.height,
        }
      : null,
    /**
     * Staggered, and the gaps are the point.
     *
     * Three compositions scheduled for the same millisecond are run by the
     * browser as one task, so an idle callback that releases all of them at
     * once buys nothing: the main thread is still busy for the sum of them,
     * with no moment in between to answer a tap. Different delays make them
     * different tasks, and a tap that lands between two of them is handled
     * rather than queued behind all three.
     */
    active ? 70 : 220 + index * 320,
  )

  // the chrome borrows its colour from whichever composition is selected
  useEffect(() => {
    if (!active || !result) return
    const root = document.documentElement
    root.style.setProperty('--art-accent', result.palette.accent)
    root.style.setProperty('--art-ground', result.palette.ground)
    root.style.setProperty('--art-ramp', result.palette.ramp[3] as string)
  }, [active, result])

  return (
    <div
      className="mframe"
      style={result ? { background: result.palette.ground } : undefined}
      aria-hidden={active ? undefined : true}
    >
      {result ? (
        <CompositionView result={result} raster {...(active ? { label } : {})} />
      ) : null}
    </div>
  )
}

export function MobileStage({
  /** true once the sheet is off its peek stop, so the controls are in use */
  tuning,
  /** px of the bottom of the studio the sheet and the action bar are covering */
  reserved,
  onOpenSheet,
}: {
  tuning: boolean
  reserved: number
  onOpenSheet: () => void
}): React.JSX.Element {
  const state = useStudio()
  const candidates = useCandidates()
  const renderer = rendererOr(state.styleId)
  const deckRef = useRef<HTMLDivElement | null>(null)

  /**
   * Measured on the untransformed box, deliberately.
   *
   * getBoundingClientRect reports the *visual* rectangle, so measuring the
   * element the scale is applied to would feed the scale back into itself and
   * settle wherever the loop happened to converge. This box is inset:0 in the
   * studio and the sheet is positioned out of flow, so it changes on a rotation
   * and never on a drag.
   */
  const [stageRef, stage] = useElementSize<HTMLDivElement>()
  /**
   * The whole composition stays on screen at every stop, however small that
   * makes it. A wallpaper is a whole-frame arrangement, so two thirds of one at
   * a comfortable size answers fewer questions than all of one at a small size
   * — and the stop where it gets small is the stop you opened to change the
   * style, not to study the result. The floor only guards against a viewport
   * short enough to make the arithmetic degenerate.
   */
  const k = stage.height > 1
    ? Math.max(0.18, Math.min(1, (stage.height - reserved) / stage.height))
    : 0.8

  /**
   * While the controls are open there is only one composition worth composing.
   *
   * The alternates are off screen and cannot change — only the selected one
   * responds to a slider — so keeping them mounted would recompose three
   * pictures per settled slider tick to show one. That is the cost that makes a
   * phone slider feel like it is dragging something heavy.
   */
  const shown = tuning ? [state.seed] : candidates
  const index = Math.max(0, shown.indexOf(state.seed))

  const rest = useCallback(
    (i: number) => `translate3d(${-i * 100}%, 0, 0)`,
    [],
  )

  // settle the deck whenever the selection or the set changes under it
  useEffect(() => {
    const node = deckRef.current
    if (!node) return
    node.style.transition = 'transform 260ms cubic-bezier(.22,.68,.24,1)'
    node.style.transform = rest(index)
  }, [index, shown.length, rest])

  /**
   * The gesture is driven through the node, not through state.
   *
   * A pointer move that calls setState re-renders the deck and every frame in
   * it sixty times a second, and React reconciling three compositions is
   * exactly the work that has to not happen while a finger is down. Writing the
   * transform straight onto the element keeps the whole drag on the compositor.
   */
  const drag = useRef<{
    id: number
    x: number
    y: number
    axis: 'none' | 'x' | 'y'
    width: number
  } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const node = deckRef.current
    if (!node) return
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      axis: 'none',
      width: node.getBoundingClientRect().width || 1,
    }
    node.style.transition = 'none'
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const node = deckRef.current
    if (!d || !node || e.pointerId !== d.id) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y

    if (d.axis === 'none') {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      // Only claim the pointer once the gesture is ours. Capturing on down
      // would swallow the vertical drag that opens the sheet.
      if (d.axis === 'x') {
        try {
          ;(e.currentTarget as HTMLElement).setPointerCapture(d.id)
        } catch {
          /* no capture available */
        }
      }
    }
    if (d.axis !== 'x') return

    // Resistance at the ends, so the deck reads as a bounded strip rather than
    // one that silently refuses to move.
    const atEnd = (dx > 0 && index === 0) || (dx < 0 && index === shown.length - 1)
    const travel = atEnd ? dx * 0.32 : dx
    node.style.transform = `translate3d(calc(${-index * 100}% + ${travel}px), 0, 0)`
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    const node = deckRef.current
    if (!d || !node || e.pointerId !== d.id) return
    drag.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(d.id)
    } catch {
      /* nothing captured */
    }
    node.style.transition = 'transform 260ms cubic-bezier(.22,.68,.24,1)'

    const dx = e.clientX - d.x
    const dy = e.clientY - d.y

    // A decisive upward drag on the picture is how the controls are reached
    // without knowing there is a sheet down there to grab.
    if (d.axis === 'y') {
      if (dy < -SWIPE) onOpenSheet()
      return
    }
    if (d.axis !== 'x') return

    const next = Math.abs(dx) > SWIPE
      ? Math.max(0, Math.min(shown.length - 1, index + (dx < 0 ? 1 : -1)))
      : index

    const seed = shown[next]
    if (seed && seed !== state.seed) {
      // Selecting here selects everywhere; the deck settles from the effect
      // that follows the selection, so there is no second copy of the position.
      actions.setSeed(seed)
    } else {
      node.style.transform = rest(index)
    }
  }

  return (
    <div className="mstage" ref={stageRef}>
      <div
        className="mstage__fit"
        style={{ '--deck-k': k } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="mstage__deck" ref={deckRef}>
          {shown.map((seed, i) => (
            <Frame
              key={seed}
              seed={seed}
              index={i}
              active={i === index}
              label={`${renderer.name}, seed ${seed}`}
            />
          ))}
        </div>
      </div>

      {shown.length > 1 ? (
        /**
         * Buttons in a group, not a tablist. A tab is a promise that it
         * controls a panel, and there are no panels here — the deck is one
         * view showing one of three seeds. Plain buttons describe what these
         * actually do, which is select.
         */
        <div className="mstage__dots" role="group" aria-label="Alternates">
          {shown.map((seed, i) => (
            <button
              key={seed}
              type="button"
              className={`mstage__dot${i === index ? ' is-on' : ''}`}
              aria-pressed={i === index}
              aria-label={`Alternate ${i + 1} of ${shown.length}`}
              onClick={() => actions.setSeed(seed)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
