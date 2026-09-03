import { makeRng } from '../engine/rng'
import type { Rng } from '../engine/rng'
import { categoryOr, conflictsWith } from './matrix'
import type { ArtCategory, Value } from './matrix'

/**
 * The art direction engine.
 *
 * A prompt generator earns its keep in two places. The first is ordering: an
 * image model weights early tokens hardest, so subject and style go first and
 * housekeeping goes last. The second is refusal — when two categories are
 * blended, some of their phrases genuinely contradict each other, and a brief
 * asking for a pitch-black background and a pastel sky at once is worse than
 * either one alone. Dropped phrases are reported rather than silently binned,
 * so the choice stays the art director's.
 *
 * Output is deterministic in (seed, request), matching the rest of the studio:
 * the same brief comes back from the same link.
 */

export type Brief = {
  category: string
  blendWith?: string
  /** overrides the picked scene */
  subject?: string
  /** phrases the user has switched off */
  excluded?: readonly string[]
  /** phrases the user has forced in past what the blend weight would take */
  pinned?: readonly string[]
  /** free text folded in at the end of the direction */
  extra?: string
  seed: string
  /** 0 = primary only, 1 = equal weight to the blend */
  blendAmount?: number
}

export type PromptResult = {
  /** the full brief, written as direction */
  prompt: string
  /** things the model should steer away from */
  negative: string
  /** a compact one-line variant for tools with a short field */
  compact: string
  /** what was used, so the UI can show the working */
  phrases: string[]
  dropped: Array<{ phrase: string; because: string }>
  /** available, but the blend weight did not reach them */
  unused: string[]
  fusion: string
  lighting: string
  uiSafety: string
  subject: string
}

const QUALITY = [
  'gallery-grade wallpaper art',
  'crisp edge definition at 100% zoom',
  'no banding in gradients',
  'balanced composition weighted to the lower two-thirds',
]

const SHARED_NEGATIVE = [
  'text', 'watermark', 'signature', 'logo', 'UI mockup', 'phone frame',
  'border', 'frame', 'collage', 'split panels', 'centred subject in the top third',
  'busy detail behind the clock area', 'lowres', 'jpeg artifacts', 'oversharpened halos',
  'distorted anatomy', 'extra limbs',
]

function joinList(items: readonly string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0] as string
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] as string}`
}

/** A blend needs one value key to win, or the brief argues with itself. */
function resolveValue(a: ArtCategory, b: ArtCategory | undefined, amount: number): {
  value: Value
  note: string | null
} {
  if (!b || a.value === b.value) return { value: a.value, note: null }
  // the darker key wins ties above half weight; darkness is not something two
  // categories can meet in the middle on
  const winner = amount > 0.5 ? b : a
  const loser = winner === a ? b : a
  return {
    value: winner.value,
    note: `${winner.name} sets the value key; ${loser.name} contributes form and detail only`,
  }
}

function pickSubject(rng: Rng, a: ArtCategory, b: ArtCategory | undefined, amount: number): string {
  const from = b && rng.next() < amount ? b : a
  return rng.pick(from.subjects)
}

/**
 * Merge two phrase lists without letting them contradict.
 * Primary phrases are kept; a secondary phrase is dropped if it fights one
 * already in the list.
 */
function mergePhrases(
  a: ArtCategory,
  b: ArtCategory | undefined,
  amount: number,
  excluded: readonly string[],
  pinned: readonly string[],
): { phrases: string[]; dropped: Array<{ phrase: string; because: string }>; unused: string[] } {
  const dropped: Array<{ phrase: string; because: string }> = []
  const phrases: string[] = []
  const unused: string[] = []

  const add = (p: string, from?: ArtCategory) => {
    if (excluded.includes(p) || phrases.includes(p)) return
    const clash = conflictsWith(p, phrases)
    if (clash) {
      dropped.push({
        phrase: p,
        because: from ? `contradicts "${clash}" from ${from.name}` : `contradicts "${clash}"`,
      })
      return
    }
    phrases.push(p)
  }

  for (const p of a.technicalPhrases) add(p)

  if (b) {
    // How many of the secondary's phrases to try, by blend weight. A phrase the
    // weight does not reach is listed as unused rather than dropped: there is
    // nothing wrong with it, there is just less of that category in the mix.
    const take = Math.max(1, Math.round(b.technicalPhrases.length * amount))
    b.technicalPhrases.forEach((p, i) => {
      if (i < take || pinned.includes(p)) add(p, a)
      else if (!excluded.includes(p) && !phrases.includes(p)) unused.push(p)
    })
  }

  return { phrases, dropped, unused }
}

export function buildPrompt(brief: Brief): PromptResult {
  const a = categoryOr(brief.category)
  const b = brief.blendWith ? categoryOr(brief.blendWith) : undefined
  const amount = Math.min(1, Math.max(0, brief.blendAmount ?? 0.5))
  const excluded = brief.excluded ?? []
  const pinned = brief.pinned ?? []
  const rng = makeRng(brief.seed, `art:${a.id}:${b?.id ?? ''}`)

  const subject = brief.subject?.trim() || pickSubject(rng, a, b, amount)
  const { phrases, dropped, unused } = mergePhrases(a, b, amount, excluded, pinned)
  const { value, note } = resolveValue(a, b, amount)

  const fusion = b
    ? `${a.aestheticFusion}, crossed with ${b.aestheticFusion}`
    : a.aestheticFusion

  const lighting = b && amount > 0.6 ? b.lightingDefault : a.lightingDefault
  const uiSafety = value === 'dark' && b?.value === 'dark' ? b.uiSafety : a.uiSafety
  const medium = b && amount > 0.65 ? b.medium : a.medium
  const palette = b && amount >= 0.5 ? `${a.palette}; tempered by ${b.palette}` : a.palette
  const mood = joinList([...a.mood.slice(0, 2), ...(b ? b.mood.slice(0, 1) : [])])

  // Order matters: an image model weights the opening hardest, so the scene and
  // the style go first and the housekeeping goes last.
  const lines = [
    `${subject}, rendered as ${medium}.`,
    `Art direction: in the manner of ${fusion}. ${cap(mood)} in feeling.`,
    phrases.length ? `Technique: ${joinList(phrases)}.` : '',
    `Lighting: ${lighting}.`,
    `Colour: ${palette}.`,
    `Format: vertical 9:16 mobile wallpaper, 1179x2556. ${uiSafety}. ` +
      `Keep the top third quiet and low-contrast so the clock and notifications stay legible; ` +
      `anchor the subject in the lower two-thirds and let forms bleed off the frame edges.`,
    note ? `Blend rule: ${note}.` : '',
    brief.extra?.trim() ? `Also: ${brief.extra.trim()}` : '',
    `Quality: ${joinList(QUALITY)}.`,
  ].filter(Boolean)

  const negative = [...SHARED_NEGATIVE, ...a.avoid, ...(b ? b.avoid : [])]
    .filter((n, i, all) => all.indexOf(n) === i)
    .join(', ')

  const compact = [
    subject,
    medium,
    `in the style of ${fusion}`,
    ...phrases,
    lighting,
    palette,
    'vertical 9:16 mobile wallpaper',
    'quiet top third for clock legibility',
    'gallery-grade',
  ].join(', ')

  return {
    prompt: lines.join('\n\n'),
    negative,
    compact,
    phrases,
    dropped,
    unused,
    fusion,
    lighting,
    uiSafety,
    subject,
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
