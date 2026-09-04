import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
 *
 * Two rules keep the drag honest, and both were learned by breaking them.
 *
 * The position is written onto the element, never held in React state. A
 * pointer move that calls setState re-renders the sheet and the whole control
 * rail underneath it — twenty-odd inputs, a params resolve and four option
 * lists — sixty times a second, and none of that work can change anything a
 * finger is looking at. React owns where the sheet comes to rest; the gesture
 * owns where it is right now.
 *
 * And the scroller is part of the gesture. A sheet whose body scrolls
 * independently of its position is two controls fighting over one finger: you
 * pull down meaning "put this away" and the list scrolls instead. Dragging down
 * from the top of the list moves the sheet, which is the only reading of that
 * gesture anyone actually intends.
 */

const ORDER: readonly Snap[] = ['peek', 'half', 'expanded']

/** Past this a gesture has declared itself a drag rather than a tap. */
const AXIS_LOCK = 6
/** A drag longer than this steps to the next stop regardless of where it ended. */
const FLICK = 40

const EASE = 'transform 260ms cubic-bezier(.22,.68,.24,1)'

export function BottomSheet({
  snap,
  onSnapChange,
  peekHeight,
  onVisibleHeight,
  label,
  title,
  children,
}: {
  snap: Snap
  onSnapChange: (snap: Snap) => void
  /** visible height in the peek position, in px */
  peekHeight: number
  /**
   * How much of the sheet is showing at rest, so the stage can keep the
   * composition clear of it. Reported at rest only, never mid-drag: the stage
   * lifts on a transform and the transition covers the gap, and reporting per
   * pointer move would put a React render back on the path of the drag.
   */
  onVisibleHeight?: (px: number) => void
  label: string
  /**
   * Shown on the handle, so the peek stop says what is behind it.
   *
   * The sheet used to peek by showing the top forty pixels of the control list,
   * which is a half a select box and the word "Categ". A strip of a control
   * nobody can use is not a preview of anything; a word is.
   */
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY)

  /**
   * Measured in a layout effect, not a passive one.
   *
   * The resting position is a function of the sheet's own height, so a height
   * that arrives after paint means the first painted frame is at the wrong
   * offset — the sheet flashed fully open and then snapped shut. A layout
   * effect lands the measurement and the transform before the browser draws.
   */
  const [height, setHeight] = useState(peekHeight)
  useLayoutEffect(() => {
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

  const drag = useRef<{
    id: number
    y: number
    /** null until the gesture has committed to moving the sheet */
    from: number | null
    fromBody: boolean
  } | null>(null)

  /** Where React says the sheet belongs, applied straight to the node. */
  useLayoutEffect(() => {
    const node = ref.current
    // a live drag owns the node; React only places it when no finger is down
    if (!node || (drag.current && drag.current.from !== null)) return
    node.style.transition = reduced ? 'none' : EASE
    node.style.transform = `translate3d(0, ${restingOffset}px, 0)`
  }, [restingOffset, reduced])

  useEffect(() => {
    onVisibleHeight?.(visible)
  }, [visible, onVisibleHeight])

  const begin = (e: React.PointerEvent, fromBody: boolean) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    drag.current = { id: e.pointerId, y: e.clientY, from: null, fromBody }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    const node = ref.current
    if (!d || !node || e.pointerId !== d.id) return
    const dy = e.clientY - d.y

    if (d.from === null) {
      if (Math.abs(dy) < AXIS_LOCK) return
      /**
       * From the body, the list gets first refusal. It only loses the gesture
       * when it has nothing left to give: at the top of its scroll and being
       * pulled further down, or at the peek stop where there is no list on
       * screen to scroll in the first place.
       */
      if (d.fromBody) {
        const body = bodyRef.current
        const scrollable = snap !== 'peek' && !!body && body.scrollHeight > body.clientHeight + 1
        if (scrollable && !(dy > 0 && body.scrollTop <= 0)) {
          drag.current = null
          return
        }
      }
      d.from = restingOffset
      d.y = e.clientY
      node.style.transition = 'none'
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(d.id)
      } catch {
        /* no capture available */
      }
      return
    }

    const at = Math.max(0, Math.min(height, d.from + (e.clientY - d.y)))
    node.style.transform = `translate3d(0, ${at}px, 0)`
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    const node = ref.current
    if (!d || !node || e.pointerId !== d.id) return
    drag.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(d.id)
    } catch {
      /* nothing captured */
    }
    if (d.from === null) return

    node.style.transition = reduced ? 'none' : EASE
    const moved = e.clientY - d.y
    const landed = d.from + moved

    // A flick beats position: a short fast drag should still change stop, and
    // with three stops it moves one step rather than jumping to an end.
    if (Math.abs(moved) > FLICK) {
      const i = ORDER.indexOf(snap)
      const next = moved > 0 ? Math.max(0, i - 1) : Math.min(ORDER.length - 1, i + 1)
      const chosen = ORDER[next] as Snap
      node.style.transform = `translate3d(0, ${Math.max(0, height - visibleFor(chosen))}px, 0)`
      onSnapChange(chosen)
      return
    }

    // otherwise settle on whichever stop the sheet was actually left nearest
    let best: Snap = snap
    let bestDist = Infinity
    for (const s of ORDER) {
      const dist = Math.abs(Math.max(0, height - visibleFor(s)) - landed)
      if (dist < bestDist) {
        bestDist = dist
        best = s
      }
    }
    node.style.transform = `translate3d(0, ${Math.max(0, height - visibleFor(best))}px, 0)`
    onSnapChange(best)
  }

  // Tapping the handle steps up through the stops and wraps back to peek, so
  // the middle position is reachable without knowing the sheet can be dragged.
  const toggle = () => {
    const i = ORDER.indexOf(snap)
    onSnapChange(ORDER[(i + 1) % ORDER.length] as Snap)
  }

  return (
    <aside className={`sheet sheet--${snap}`} ref={ref} aria-label={label}>
      <div
        className="sheet__grip"
        onPointerDown={(e) => begin(e, false)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          type="button"
          className="sheet__handle"
          onClick={toggle}
          aria-expanded={snap !== 'peek'}
          /**
           * The visible word leads the accessible name. A control that reads
           * "Tune" and announces "Show the controls" cannot be operated by
           * anyone speaking what they can see, which is how voice control
           * works and why the mismatch is a failure rather than a nicety.
           */
          aria-label={
            snap === 'peek' ? `${title}. Show the controls`
              : snap === 'half' ? `${title}. Show all the controls`
                : `${title}. Hide the controls`
          }
        >
          <span className="sheet__pip" />
          <span className="sheet__title">{title}</span>
        </button>
      </div>
      <div
        className="sheet__body"
        ref={bodyRef}
        onPointerDown={(e) => begin(e, true)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </aside>
  )
}
