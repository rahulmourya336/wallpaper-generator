import { useSyncExternalStore } from 'react'
import { allRenderers, rendererOr, familyOf, DEFAULT_STYLE_ID } from '../engine/registry'
import { resolveParams } from '../engine/compositor'
import { SEED_ALPHABET, SEED_LENGTH, isValidSeed } from '../engine/rng'
import { DEFAULT_PRESET_ID, resolveSize } from '../export/presets'
import type { ParamSchema } from '../engine/types'

export type StudioState = {
  categoryId: string
  styleId: string
  /** base36, 6 chars */
  seed: string
  seedLocked: boolean
  /** 'auto' lets the seed choose from the style's own list */
  paletteId: string
  params: Record<string, number | string>
  exportPreset: string
  focusMode: boolean
}

export const AUTO_PALETTE = 'auto'

/**
 * The only place in the app allowed to be non-deterministic. Nothing under
 * engine/ may call this, or the same hash would stop reproducing.
 */
export function newSeed(): string {
  const bytes = new Uint8Array(SEED_LENGTH)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < SEED_LENGTH; i++) {
    out += SEED_ALPHABET[(bytes[i] as number) % SEED_ALPHABET.length]
  }
  return out
}

function randomUnit(): number {
  const b = new Uint32Array(1)
  crypto.getRandomValues(b)
  return (b[0] as number) / 4294967296
}

/** Sample the middle of each range — the extremes are where compositions break. */
function randomizeParams(schema: ParamSchema): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  for (const spec of schema) {
    if (spec.type === 'range') {
      const span = spec.max - spec.min
      const v = spec.min + span * 0.1 + randomUnit() * span * 0.8
      out[spec.key] = Math.round(v / spec.step) * spec.step
    } else {
      out[spec.key] = spec.options[Math.floor(randomUnit() * spec.options.length)] as string
    }
  }
  return out
}

// --- hash serialisation ----------------------------------------------------

const HASH_VERSION = '1'

function encodeHash(s: StudioState): string {
  const q = new URLSearchParams()
  q.set('v', HASH_VERSION)
  q.set('y', s.styleId)
  q.set('s', s.seed)
  if (s.paletteId !== AUTO_PALETTE) q.set('p', s.paletteId)
  if (s.seedLocked) q.set('l', '1')
  if (s.focusMode) q.set('f', '1')
  if (s.exportPreset !== DEFAULT_PRESET_ID) q.set('e', s.exportPreset)
  const schema = rendererOr(s.styleId).schema
  const resolved = resolveParams(schema, s.params)
  for (const spec of schema) {
    const v = resolved[spec.key]
    if (v === undefined || v === spec.default) continue
    q.set(`k.${spec.key}`, typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v)
  }
  return q.toString()
}

/**
 * Decodes a COMPLETE state, filling every field a hash leaves out with its
 * default. Merging a partial decode over the live state would mean a link
 * reproduced a different wallpaper depending on whether the visitor arrived
 * cold or navigated within the session — the whole point of the hash is that
 * it is the composition, so it has to be authoritative for every field.
 *
 * `fallbackSeed` only applies when the hash carries no seed at all.
 */
function decodeHash(hash: string, fallbackSeed: string): StudioState {
  const q = new URLSearchParams(hash.replace(/^#/, ''))

  const style = q.get('y')
  const styleId = style && rendererOr(style).id === style ? style : DEFAULT_STYLE_ID
  const seed = q.get('s')
  const palette = q.get('p')
  const preset = q.get('e')

  const params: Record<string, number | string> = {}
  for (const [key, value] of q.entries()) {
    if (!key.startsWith('k.')) continue
    const n = Number(value)
    params[key.slice(2)] = value !== '' && Number.isFinite(n) ? n : value
  }

  return {
    styleId,
    categoryId: familyOf(styleId),
    seed: seed && isValidSeed(seed) ? seed : fallbackSeed,
    seedLocked: q.get('l') === '1',
    paletteId: palette ?? AUTO_PALETTE,
    params,
    exportPreset: preset && resolveSize(preset).id === preset ? preset : DEFAULT_PRESET_ID,
    focusMode: q.get('f') === '1',
  }
}

function initialState(): StudioState {
  return decodeHash(typeof location !== 'undefined' ? location.hash : '', newSeed())
}

// --- store -----------------------------------------------------------------

let state: StudioState = initialState()
const listeners = new Set<() => void>()
let writingHash = false

function emit(): void {
  for (const l of listeners) l()
}

function writeHash(replace: boolean): void {
  if (typeof location === 'undefined') return
  const next = `#${encodeHash(state)}`
  if (next === location.hash) return
  writingHash = true
  const url = `${location.pathname}${location.search}${next}`
  if (replace) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
  // hashchange fires asynchronously; clear the guard after it has had a turn
  setTimeout(() => { writingHash = false }, 0)
}

/**
 * Replacements are coalesced; pushes go straight through.
 *
 * Dragging a slider changes state on every pointer move, and one
 * history.replaceState per move is both wasted work and a real limit: Safari
 * throws once a document exceeds about a hundred history writes in thirty
 * seconds, which a single sustained drag will do. Pushes come from discrete
 * actions (shuffle, restyle) and must land immediately so the back button
 * steps through them one at a time.
 */
const HASH_COALESCE_MS = 150
let hashTimer = 0
let hashPending = false

function cancelPendingHash(): void {
  if (typeof window === 'undefined') return
  window.clearTimeout(hashTimer)
  hashTimer = 0
  hashPending = false
}

function flushHash(): void {
  const pending = hashPending
  cancelPendingHash()
  if (pending) writeHash(true)
}

function syncHash(replace: boolean): void {
  if (typeof window === 'undefined') return
  if (!replace) {
    cancelPendingHash()
    writeHash(false)
    return
  }
  hashPending = true
  if (hashTimer) return
  hashTimer = window.setTimeout(flushHash, HASH_COALESCE_MS)
}

function set(patch: Partial<StudioState>, opts: { push?: boolean } = {}): void {
  state = { ...state, ...patch }
  syncHash(!opts.push)
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    if (writingHash) return
    // an incoming navigation wins: a queued write is stale by definition, and
    // flushing it here would immediately overwrite the URL we just arrived at
    cancelPendingHash()
    state = decodeHash(location.hash, state.seed)
    emit()
  })
  // a coalesced write must not be lost to a navigation or a backgrounded tab
  window.addEventListener('pagehide', flushHash)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushHash()
  })
  writeHash(true)
}

export function getState(): StudioState {
  return state
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useStudio(): StudioState {
  return useSyncExternalStore(subscribe, getState, getState)
}

// --- actions ---------------------------------------------------------------

export const actions = {
  /**
   * Unlocked: a new style, category and seed, so shuffle explores the whole
   * catalogue. Locked: the composition holds and the tuning is re-rolled.
   */
  shuffle(): void {
    if (state.seedLocked) {
      set({ params: randomizeParams(rendererOr(state.styleId).schema) }, { push: true })
      return
    }
    /**
     * Shuffle moves the whole idea, not just the dice.
     *
     * Re-rolling the seed alone kept every result inside the style you happened
     * to land on, so shuffling repeatedly showed one motif over and over. It
     * now picks a fresh style too, which is what makes the button a way to
     * explore the catalogue rather than a way to resample one corner of it.
     * The lock still holds everything but the parameters, so anyone who has
     * found a style they like can pin it.
     */
    const styles = allRenderers()
    const next = styles[Math.floor(randomUnit() * styles.length)] ?? rendererOr(state.styleId)
    set(
      { seed: newSeed(), styleId: next.id, categoryId: familyOf(next.id), params: {} },
      { push: true },
    )
  },

  /** Same seed, same params, different style. The filmstrip's whole purpose. */
  setStyle(styleId: string): void {
    const r = rendererOr(styleId)
    set({ styleId: r.id, categoryId: familyOf(r.id) }, { push: true })
  },

  setCategory(categoryId: string): void {
    if (categoryId === state.categoryId) return
    set({ categoryId })
  },

  setSeed(seed: string): void {
    if (isValidSeed(seed)) set({ seed })
  },

  toggleLock(): void {
    set({ seedLocked: !state.seedLocked })
  },

  setPalette(paletteId: string): void {
    set({ paletteId })
  },

  setParam(key: string, value: number | string): void {
    set({ params: { ...state.params, [key]: value } })
  },

  resetParams(): void {
    set({ params: {} })
  },

  setExportPreset(exportPreset: string): void {
    set({ exportPreset })
  },

  setFocusMode(focusMode: boolean): void {
    set({ focusMode })
  },
}
