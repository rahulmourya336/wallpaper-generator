/**
 * The GPU switch.
 *
 * Opt-in, via `?gpu`, and that is a deliberate choice rather than caution.
 * The WebGL2 path is architecturally complete — the distance field, the
 * G-buffer, occlusion, cone-marched shadows, subsurface, a real
 * circle-of-confusion gather and the bloom chain all work — but on the one
 * family ported it is not yet at visual parity with the CPU pipeline. It comes
 * out darker and its fine detail reads harder, and shipping that as the
 * default would be shipping a regression to every visitor in exchange for an
 * architecture they cannot see. So the default stays on the path that looks
 * better, and the new one is reachable, testable and measured until it wins on
 * its own merit.
 *
 * The CPU pipeline is the floor of this system in any case: it is what runs
 * where WebGL2 has no float render targets, what runs in the headless sweeps,
 * and what the golden images will be compared against.
 */

let override: boolean | null = null

export function gpuEnabled(): boolean {
  if (override !== null) return override
  if (typeof location === 'undefined') return false
  const q = new URLSearchParams(location.search)
  if (q.has('cpu')) return false
  return q.has('gpu')
}

/** For probes and tests that need to pin a backend. */
export function setGpuOverride(on: boolean | null): void {
  override = on
}
