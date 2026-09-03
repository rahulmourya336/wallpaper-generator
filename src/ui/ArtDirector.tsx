import { useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, categoryOr } from '../art/matrix'
import { buildPrompt } from '../art/prompt'
import { newSeed, useStudio } from '../state/useStudio'
import { Select } from './Select'
import type { Option } from './Select'

/**
 * The art direction panel.
 *
 * It writes briefs for an image model rather than drawing anything itself, so
 * it lives behind its own dialog instead of adding another column to a stage
 * that is meant to stay a single decision. The working is on show — which
 * phrases went in, and which were dropped for contradicting one another —
 * because an art director needs to see the edit, not just the result.
 */

const NONE = 'none'

function CopyBlock({
  label,
  value,
  rows,
}: {
  label: string
  value: string
  rows: number
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // clipboard can be blocked; the text is selectable either way
      setCopied(false)
    }
  }

  return (
    <div className="brief">
      <div className="brief__head">
        <span className="field__label">{label}</span>
        <button type="button" className="btn brief__copy" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <textarea className="brief__text" readOnly rows={rows} value={value} spellCheck={false} />
    </div>
  )
}

export function ArtDirector({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const studio = useStudio()
  const ref = useRef<HTMLDialogElement | null>(null)

  const [category, setCategory] = useState(CATEGORIES[0]?.id ?? '')
  const [blendWith, setBlendWith] = useState(NONE)
  const [blendAmount, setBlendAmount] = useState(0.5)
  const [excluded, setExcluded] = useState<string[]>([])
  const [pinned, setPinned] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [extra, setExtra] = useState('')
  const [seed, setSeed] = useState(studio.seed)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  const primary = categoryOr(category)
  const secondary = blendWith === NONE ? undefined : categoryOr(blendWith)

  // every phrase either category can contribute, for the toggles
  const allPhrases = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const p of primary.technicalPhrases) if (!seen.has(p)) { seen.add(p); out.push(p) }
    if (secondary) for (const p of secondary.technicalPhrases) if (!seen.has(p)) { seen.add(p); out.push(p) }
    return out
  }, [primary, secondary])

  const result = useMemo(
    () =>
      buildPrompt({
        category,
        seed,
        blendAmount,
        ...(blendWith !== NONE ? { blendWith } : {}),
        ...(subject.trim() ? { subject } : {}),
        ...(extra.trim() ? { extra } : {}),
        excluded,
        pinned,
      }),
    [category, blendWith, blendAmount, subject, extra, excluded, pinned, seed],
  )

  const categoryOptions: Option[] = CATEGORIES.map((c) => ({
    value: c.id,
    label: c.name,
    hint: c.value,
  }))

  const blendOptions: Option[] = [
    { value: NONE, label: 'None', hint: 'single' },
    ...CATEGORIES.filter((c) => c.id !== category).map((c) => ({ value: c.id, label: c.name })),
  ]

  /**
   * A chip is lit when the phrase is genuinely in the brief, so clicking it has
   * to mean two different things: take an in-use phrase out, or pull an unused
   * one in past what the blend weight reached. Anything else would leave chips
   * claiming credit for words the model never sees.
   */
  const togglePhrase = (p: string, inUse: boolean) => {
    if (inUse) {
      setPinned((prev) => prev.filter((x) => x !== p))
      setExcluded((prev) => (prev.includes(p) ? prev : [...prev, p]))
      return
    }
    setExcluded((prev) => prev.filter((x) => x !== p))
    setPinned((prev) => (prev.includes(p) ? prev : [...prev, p]))
  }

  return (
    <dialog
      className="export art"
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-labelledby="art-title"
    >
      {!open ? null : (
        <>
          <div className="export__head">
            <h2 id="art-title">Art direction</h2>
            <button type="button" className="export__close" onClick={onClose} aria-label="Close art direction">
              &times;
            </button>
          </div>

          <div className="export__body art__body">
            <div className="export__fields">
              <Select
                id="art-category"
                label="Category"
                value={category}
                options={categoryOptions}
                onChange={(v) => {
                  setCategory(v)
                  if (v === blendWith) setBlendWith(NONE)
                  setExcluded([])
                  setPinned([])
                }}
              />
              <Select
                id="art-blend"
                label="Blend with"
                value={blendWith}
                options={blendOptions}
                onChange={(v) => {
                  setBlendWith(v)
                  setExcluded([])
                  setPinned([])
                }}
              />

              {blendWith !== NONE ? (
                <div className="field">
                  <label className="field__head" htmlFor="art-amount">
                    <span className="field__label">Blend weight</span>
                    <output className="field__meta" htmlFor="art-amount">
                      {Math.round(blendAmount * 100)}%
                    </output>
                  </label>
                  <input
                    id="art-amount"
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={blendAmount}
                    onChange={(e) => setBlendAmount(Number(e.currentTarget.value))}
                  />
                </div>
              ) : null}

              <div className="field">
                <label className="field__head" htmlFor="art-subject">
                  <span className="field__label">Subject</span>
                  <span className="field__meta">optional</span>
                </label>
                <input
                  id="art-subject"
                  className="art__input"
                  type="text"
                  value={subject}
                  placeholder={result.subject}
                  onChange={(e) => setSubject(e.currentTarget.value)}
                />
              </div>

              <div className="field">
                <label className="field__head" htmlFor="art-extra">
                  <span className="field__label">Add direction</span>
                  <span className="field__meta">optional</span>
                </label>
                <input
                  id="art-extra"
                  className="art__input"
                  type="text"
                  value={extra}
                  placeholder="e.g. shot from below, single figure for scale"
                  onChange={(e) => setExtra(e.currentTarget.value)}
                />
              </div>

              <div className="field">
                <span className="field__head">
                  <span className="field__label">Technique</span>
                  <span className="field__meta">{result.phrases.length} in use</span>
                </span>
                <div className="art__phrases">
                  {allPhrases.map((p) => {
                    const inUse = result.phrases.includes(p)
                    const clash = result.dropped.find((d) => d.phrase === p)
                    const thin = result.unused.includes(p)
                    const cls = clash ? ' is-clash' : inUse ? '' : ' is-off'
                    return (
                      <button
                        key={p}
                        type="button"
                        className={`art__phrase${cls}`}
                        onClick={() => togglePhrase(p, inUse)}
                        aria-pressed={inUse}
                        title={
                          clash
                            ? `Left out, ${clash.because}`
                            : inUse
                              ? 'In the brief. Click to remove'
                              : thin
                                ? 'Not reached at this blend weight. Click to force it in'
                                : 'Switched off. Click to put it back'
                        }
                      >
                        {p}
                      </button>
                    )
                  })}
                </div>
                {result.dropped.length ? (
                  <p className="art__note">
                    Dropped for contradiction:{' '}
                    {result.dropped.map((d) => `"${d.phrase}" ${d.because}`).join('; ')}.
                  </p>
                ) : null}
                {result.unused.length ? (
                  <p className="art__note">
                    {result.unused.length} more from {secondary?.name}{' '}
                    {result.unused.length === 1 ? 'sits' : 'sit'} outside this blend weight. Raise
                    the weight, or click one to force it in.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="art__out">
              <CopyBlock label="Prompt" value={result.prompt} rows={14} />
              <CopyBlock label="Negative prompt" value={result.negative} rows={3} />
              <CopyBlock label="One line" value={result.compact} rows={3} />
            </div>
          </div>

          <div className="export__foot">
            <p className="export__file">
              {primary.name}
              {secondary ? ` + ${secondary.name}` : ''} · seed {seed}
            </p>
            <div className="export__actions">
              <button type="button" className="btn" onClick={() => setSeed(newSeed())}>
                New variation
              </button>
              <button type="button" className="btn btn--primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  )
}
