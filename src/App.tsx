import { useState } from 'react'
import { Canvas } from './ui/Canvas'
import { ControlRail } from './ui/ControlRail'
import { ExportDialog } from './ui/ExportDialog'
import { Filmstrip } from './ui/Filmstrip'
import { StagePills } from './ui/StagePills'

export function App(): React.JSX.Element {
  const [exporting, setExporting] = useState(false)

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="topbar__title">
          Wallpaper Studio
          <span className="topbar__sub">Generative wallpapers, rendered in your browser</span>
        </h1>
      </header>

      <main className="studio">
        <section className="stage" aria-label="Wallpaper preview">
          <div className="stage__canvas">
            <Canvas />
            <StagePills onExport={() => setExporting(true)} />
          </div>
          <Filmstrip />
        </section>
        <ControlRail />
      </main>

      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
    </div>
  )
}
