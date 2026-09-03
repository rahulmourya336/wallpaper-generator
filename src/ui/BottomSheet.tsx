import { useCallback, useEffect, useRef, useState } from 'react'
import { REDUCED_MOTION_QUERY, useMediaQuery } from './useMediaQuery'

export type Snap = 'peek' | 'half' | 'expanded'

/**
 * Three-height draggable sheet.
 *
 * Two heights were not enough, and the reason is the whole point of the
 * control it contains. Opening the sheet to reach a slider covered the
 * composition the slider was changing, so tuning meant dragging blind and then
 * collapsing the sheet to find out what you had done. A middle stop leaves the
 * picture on screen while the controls are in reach, which is the only
 * arrangement in which a slider is a slider rather than a guess.
 *
 * The sheet is always laid out at its expanded height and translated down to
 * reach the shorter stops, so its content never reflows while dragging — a
 * sheet that animates its own height re-lays out its contents on every pointer
 * move and drops frames on exactly the interaction it exists for.
 */

const ORDER: readonly Snap[] = ['peek', 'half', 'expanded']

export function BottomSheet({
  snap,
  onSnapChange,
  peekHeight,
  onVisibleHeight,
  label,
  children,
}: {
  snap: Snap
  onSnapChange: (snap: Snap) => void
  /** visible height in the peek position, in px */
  peekHeight: number
  /**
   * How much of the sheet is showing at rest, so the stage can keep the
   * composition clear of it. Reported at rest only, never mid-drag: the stage
   * re-measures and recomposes when it resizes, and doing that on every
   * pointer move would stall the drag.
   */
  onVisibleHeight?: (px: number) => void
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLElement | null>(null)
  const [drag, setDrag] = useState<{ startY: number; offset: number } | null>(null)
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)

  /**
   * Seeded with the peek height rather than zero.
   *
   * The measurement lands in an effect, so on the very first frame the height
   * is whatever it was initialised to — and a zero there makes `resting` zero,
   * which is the fully open position. The sheet flashed open on load and then
   * snapped shut. Starting at the peek height means the first frame is already
   * the position it is about to settle into.
   */
  const [height, setHeight] = useState(peekHeight)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => setHeight(node.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const visibleFor = useCallback(
    (s: Snap) =>
      s === 'expanded' ? height
        : s === 'half' ? Math.min(height, Math.max(peekHeight, height * 0.56))
          : Math.min(height, peekHeight),
    [height, peekHeight],
  )

  const visible = visibleFor(snap)
  const restingOffset = Math.max(0, height - visible)
  const offset = drag ? Math.max(0, Math.min(height, restingOffset + drag.offset)) : restingOffset

  useEffect(() => {
    onVisibleHeight?.(visible)
  }, [visible, onVisibleHeight])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    // Capture can throw if the pointer is already gone; the drag should still
    // start, it just will not follow the pointer outside the element.
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* no capture available */
    }
    setDrag({ startY: e.clientY, offset: 0 })
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return
      setDrag({ startY: drag.startY, offset: e.clientY - drag.startY })
    },
    [drag],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drag) return
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        /* nothing captured */
      }
      const landed = restingOffset + drag.offset
      setDrag(null)

      // A flick beats position: a short fast drag should still change stop, and
      // with three stops it moves one step rather than jumping to an end.
      if (Math.abs(drag.offset) > 40) {
        const i = ORDER.indexOf(snap)
        const next = drag.offset > 0 ? Math.max(0, i - 1) : Math.min(ORDER.length - 1, i + 1)
        onSnapChange(ORDER[next] as Snap)
        return
      }

      // otherwise settle on whichever stop the sheet was actually left nearest
      let best: Snap = snap
      let bestDist = Infinity
      for (const s of ORDER) {
        const d = Math.abs(Math.max(0, height - visibleFor(s)) - landed)
        if (d < bestDist) {
          bestDist = d
          best = s
        }
      }
      onSnapChange(best)
    },
    [drag, height, restingOffset, snap, onSnapChange, visibleFor],
  )

  // Tapping the handle steps up through the stops and wraps back to peek, so
  // the middle position is reachable without knowing the sheet can be dragged.
  const toggle = () => {
    const i = ORDER.indexOf(snap)
    onSnapChange(ORDER[(i + 1) % ORDER.length] as Snap)
  }

  return (
    <aside
      className={`sheet${drag ? ' is-dragging' : ''}`}
      ref={ref}
      aria-label={label}
      style={{
        transform: `translateY(${offset}px)`,
        transition: drag || reduced ? 'none' : 'transform 240ms cubic-bezier(.22,.68,.24,1)',
      }}
    >
      <div
        className="sheet__grip"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          type="button"
          className="sheet__handle"
          onClick={toggle}
          aria-expanded={snap !== 'peek'}
          aria-label={
            snap === 'peek' ? 'Show the controls'
              : snap === 'half' ? 'Show all the controls'
                : 'Hide the controls'
          }
        >
          <span />
        </button>
      </div>
      <div className="sheet__body">{children}</div>
    </aside>
  )
}
