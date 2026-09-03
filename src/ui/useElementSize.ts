import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export type Size = { width: number; height: number }

/**
 * Measured content box of a node.
 *
 * The first measurement is taken synchronously from getBoundingClientRect
 * rather than waiting for ResizeObserver's first delivery: observer callbacks
 * are flushed at a rendering opportunity, so a page opened in a background tab
 * would otherwise sit at zero size and never draw anything.
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

    const ro = new ResizeObserver(() => measure(nodeRef.current))
    ro.observe(node)
    const onResize = () => measure(nodeRef.current)
    window.addEventListener('resize', onResize, { passive: true })
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [measure])

  return [setNode, size]
}
