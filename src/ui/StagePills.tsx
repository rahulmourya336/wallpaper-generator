import { actions, useCanGoBack, useStudio } from '../state/useStudio'

function ShuffleIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 7h4l4.5 10H17" />
      <path d="M3 17h4l4.5-10H17" />
      <path d="m15 4 3 3-3 3" />
      <path d="m15 14 3 3-3 3" />
    </svg>
  )
}

function BackIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 5.5 4 10.5l5 5" />
      <path d="M4 10.5h9a6 6 0 0 1 0 12h-2" />
    </svg>
  )
}

function LockIcon({ locked }: { locked: boolean }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      {locked ? <path d="M8.5 10.5V7.5a3.5 3.5 0 1 1 7 0v3" /> : <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2" />}
    </svg>
  )
}

function ExportIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.5v11" />
      <path d="m7.5 10 4.5 4.5 4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </svg>
  )
}

export function StagePills({ onExport }: { onExport: () => void }): React.JSX.Element {
  const state = useStudio()
  const canGoBack = useCanGoBack()
  const lockLabel = state.seedLocked
    ? 'Style locked. Shuffle re-rolls the settings only. Click to unlock.'
    : 'Style unlocked. Shuffle picks a new style. Click to lock this one.'

  return (
    <div className="pill pill--actions">
        <button
          type="button"
          className="pill__btn pill__btn--icon"
          onClick={() => actions.back()}
          disabled={!canGoBack}
          aria-label="Go back to the previous design"
          title={canGoBack ? 'Back to the previous design' : 'Nothing to go back to yet'}
        >
          <BackIcon />
        </button>
        <button
          type="button"
          className="pill__btn pill__btn--primary"
          onClick={() => actions.shuffle()}
          title={state.seedLocked ? 'Shuffle the settings' : 'Shuffle style and design'}
        >
          <ShuffleIcon />
          <span>{state.seedLocked ? 'Reshuffle' : 'Shuffle'}</span>
        </button>
        <button
          type="button"
          className={`pill__btn pill__btn--icon${state.seedLocked ? ' is-active' : ''}`}
          onClick={() => actions.toggleLock()}
          aria-pressed={state.seedLocked}
          aria-label={lockLabel}
          title={lockLabel}
        >
          <LockIcon locked={state.seedLocked} />
        </button>
        <button
          type="button"
          className="pill__btn pill__btn--icon"
          onClick={onExport}
          aria-label="Open the export dialog"
          title="Export"
        >
          <ExportIcon />
        </button>
    </div>
  )
}
