import { useSyncExternalStore } from 'react'

const cache = new Map<string, MediaQueryList>()

function listFor(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || !window.matchMedia) return null
  const existing = cache.get(query)
  if (existing) return existing
  const created = window.matchMedia(query)
  cache.set(query, created)
  return created
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = listFor(query)
      if (!list) return () => {}
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => listFor(query)?.matches ?? false,
    () => false,
  )
}

export const MOBILE_QUERY = '(max-width: 52rem)'
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
