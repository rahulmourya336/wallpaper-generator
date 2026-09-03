import { useCallback, useEffect, useId, useRef, useState } from 'react'

/**
 * A listbox that can show something other than text.
 *
 * A native <select> cannot hold a swatch, a glyph or a live thumbnail, and for
 * a tool where every choice is visual that leaves the controls describing the
 * artwork in words instead of showing it. This keeps the keyboard behaviour a
 * select has — type-ahead aside — and lets each option carry a picture.
 */

export type Option = {
  value: string
  label: string
  /** shown before the label, in the button and in the list */
  icon?: React.ReactNode
  hint?: string
  group?: string
}

export function Select({
  id,
  label,
  value,
  options,
  onChange,
  meta,
}: {
  id: string
  label: string
  value: string
  options: readonly Option[]
  onChange: (value: string) => void
  /** small right-aligned note next to the label, e.g. the pixel size */
  meta?: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const listId = useId()

  const current = options.find((o) => o.value === value) ?? options[0]
  const currentIndex = Math.max(0, options.findIndex((o) => o.value === value))

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    setActive(currentIndex)
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, currentIndex, close])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const pick = (v: string) => {
    onChange(v)
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); close(); return }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const opt = options[active]
      if (opt) pick(opt.value)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + options.length) % options.length)
    }
    if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1) }
  }

  let lastGroup: string | undefined

  return (
    <div className="field" ref={rootRef}>
      <div className="field__head">
        <span className="field__label" id={`${id}-label`}>{label}</span>
        {meta ? <span className="field__meta">{meta}</span> : null}
      </div>
      <button
        type="button"
        id={id}
        className={`picker${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        {current?.icon ? <span className="picker__icon">{current.icon}</span> : null}
        <span className="picker__text">{current?.label ?? ''}</span>
        <svg className="picker__caret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <ul
          className="picker__list"
          id={listId}
          role="listbox"
          aria-labelledby={`${id}-label`}
          ref={listRef}
          tabIndex={-1}
        >
          {options.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? o.group : null
            lastGroup = o.group
            return (
              <li key={o.value} role="presentation">
                {head ? <p className="picker__group">{head}</p> : null}
                <div
                  role="option"
                  aria-selected={o.value === value}
                  data-active={i === active}
                  className={`picker__opt${o.value === value ? ' is-current' : ''}${i === active ? ' is-active' : ''}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => pick(o.value)}
                >
                  {o.icon ? <span className="picker__icon">{o.icon}</span> : null}
                  <span className="picker__text">{o.label}</span>
                  {o.hint ? <span className="picker__hint">{o.hint}</span> : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
