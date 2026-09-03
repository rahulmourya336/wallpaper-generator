import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export type Size = { width: number; height: number }

/**
 * Measured content box of a node.
 *
 * Two things this has to get right, and they pull against each other.
 *
 * The first measurement cannot wait for ResizeObserver's first delivery.
 * Observer callbacks are flushed at a rendering opportunity, so a page opened
 * in a background tab would sit at zero size and never draw anything at all.
 * So the box is read synchronously from the callback ref and again on commit.
 *
 * But getBoundingClientRect forces a synchronous layout, and this hook measures
 * the box wrapping a composition that can hold several thousand SVG nodes.
 * Measuring on every commit therefore put a full layout on the path of every
 * slider tick. So the extra reads are a short bounded schedule after mount,
 * which is enough to catch a sibling (the filmstrip) that mounts a commit or
 * two later and takes space away, and costs nothing thereafter.
 */
export function useElementSize<T extends HTMLElement>(): [
  (node: T | null) => void,
  Size,
] {
  const nodeRef = useRef<T | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  const measure = useCallback((node: T | null) => {
    if (!node) return
    const box = node.getBoundingClientRect()
    setSize((prev) =>
      Math.abs(prev.width - box.width) < 0.5 && Math.abs(prev.height - box.height) < 0.5
        ? prev
        : { width: box.width, height: box.height },
    )
  }, [])

  const setNode = useCallback(
    (node: T | null) => {
      nodeRef.current = node
      measure(node)
    },
    [measure],
  )

  useLayoutEffect(() => {
    const node = nodeRef.current
    if (!node) return
    measure(node)

    // timers rather than frames, so this still settles in a tab the browser
    // has decided not to render
    const settle = [0, 80, 300].map((delay) =>
      window.setTimeout(() => measure(nodeRef.current), delay),
    )
    const ro = new ResizeObserver(() => measure(nodeRef.current))
    ro.observe(node)
    const onResize = () => measure(nodeRef.current)
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      for (const id of settle) window.clearTimeout(id)
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [measure])

  return [setNode, size]
}
