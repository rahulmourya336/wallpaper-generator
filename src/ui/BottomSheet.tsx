import { useCallback, useEffect, useRef, useState } from 'react'
import { REDUCED_MOTION_QUERY, useMediaQuery } from './useMediaQuery'

export type Snap = 'peek' | 'expanded'

/**
 * Two-height draggable sheet.
 *
 * The sheet is always laid out at its expanded height and translated down to
 * reach the peek position, so its content never reflows while dragging — a
 * sheet that animates its own height re-lays out the filmstrip on every
 * pointer move and drops frames on exactly the interaction it exists for.
 */
export function BottomSheet({
  snap,
  onSnapChange,
  peekHeight,
  label,
  children,
}: {
  snap: Snap
  onSnapChange: (snap: Snap) => void
  /** visible height in the peek position, in px */
  peekHeight: number
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLElement | null>(null)
  const [drag, setDrag] = useState<{ startY: number; offset: number } | null>(null)
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)

  const [height, setHeight] = useState(0)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => setHeight(node.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const restingOffset = snap === 'expanded' ? 0 : Math.max(0, height - peekHeight)
  const offset = drag ? Math.max(0, Math.min(height, restingOffset + drag.offset)) : restingOffset

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
      const travel = Math.max(1, height - peekHeight)
      const landed = restingOffset + drag.offset
      // a flick beats position: a short fast drag should still change snap
      const flick = Math.abs(drag.offset) > 40 ? (drag.offset > 0 ? 'peek' : 'expanded') : null
      setDrag(null)
      onSnapChange(flick ?? (landed > travel / 2 ? 'peek' : 'expanded'))
    },
    [drag, height, peekHeight, restingOffset, onSnapChange],
  )

  const toggle = () => onSnapChange(snap === 'peek' ? 'expanded' : 'peek')

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
          aria-expanded={snap === 'expanded'}
          aria-label={snap === 'expanded' ? 'Collapse controls' : 'Expand controls'}
        >
          <span />
        </button>
      </div>
      <div className="sheet__body">{children}</div>
    </aside>
  )
}
