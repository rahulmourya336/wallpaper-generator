import { actions, useStudio } from '../state/useStudio'

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
  const lockLabel = state.seedLocked
    ? 'Seed locked. Shuffle will re-roll the parameters. Click to unlock.'
    : 'Seed unlocked. Shuffle will pick a new seed. Click to lock.'

  return (
    <>
      <div className="pill pill--actions">
        <button
          type="button"
          className="pill__btn pill__btn--primary"
          onClick={() => actions.shuffle()}
          title={state.seedLocked ? 'Shuffle parameters' : 'Shuffle seed'}
        >
          <ShuffleIcon />
          <span>{state.seedLocked ? 'Shuffle params' : 'Shuffle'}</span>
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

      <p className="pill pill--seed">
        <span className="pill__label">Seed</span>
        <span className="pill__seed">{state.seed}</span>
      </p>
    </>
  )
}
