import { useState } from 'react'
import { BottomSheet } from './ui/BottomSheet'
import type { Snap } from './ui/BottomSheet'
import { Canvas } from './ui/Canvas'
import { ControlRail } from './ui/ControlRail'
import { ExportDialog } from './ui/ExportDialog'
import { Filmstrip } from './ui/Filmstrip'
import { StagePills } from './ui/StagePills'
import { MOBILE_QUERY, useMediaQuery } from './ui/useMediaQuery'
import { actions, useStudio } from './state/useStudio'

const PEEK_HEIGHT = 168

function RailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className="rail-toggle"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="control-rail"
      aria-label={open ? 'Collapse the control rail' : 'Expand the control rail'}
      title={open ? 'Focus mode' : 'Show controls'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={open ? 'm9 6 6 6-6 6' : 'm15 6-6 6 6 6'} />
      </svg>
    </button>
  )
}

export function App(): React.JSX.Element {
  const state = useStudio()
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const [exporting, setExporting] = useState(false)
  const [snap, setSnap] = useState<Snap>('peek')

  const openExport = () => setExporting(true)

  return (
    <div className={`app${isMobile ? ' app--mobile' : ''}`}>
      {isMobile ? null : (
        <header className="topbar">
          <h1 className="topbar__title">
            Wallpaper Studio
            <span className="topbar__sub">Generative wallpapers, rendered in your browser</span>
          </h1>
        </header>
      )}

      {isMobile ? (
        <main className="studio studio--mobile">
          <h1 className="visually-hidden">Wallpaper Studio — generative wallpapers</h1>
          <section className="stage stage--bleed" aria-label="Wallpaper preview">
            <div className="stage__canvas">
              <Canvas />
              <StagePills onExport={openExport} />
            </div>
          </section>
          <BottomSheet
            snap={snap}
            onSnapChange={setSnap}
            peekHeight={PEEK_HEIGHT}
            label="Composition controls"
          >
            <Filmstrip />
            <ControlRail />
          </BottomSheet>
        </main>
      ) : (
        <main className={`studio${state.focusMode ? ' studio--focus' : ''}`}>
          <section className="stage" aria-label="Wallpaper preview">
            <div className="stage__canvas">
              <Canvas />
              <StagePills onExport={openExport} />
            </div>
            <Filmstrip />
          </section>
          <RailToggle
            open={!state.focusMode}
            onToggle={() => actions.setFocusMode(!state.focusMode)}
          />
          <ControlRail id="control-rail" hidden={state.focusMode} />
        </main>
      )}

      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
    </div>
  )
}
