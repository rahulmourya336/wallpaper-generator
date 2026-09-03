import { Canvas } from './ui/Canvas'
import { ControlRail } from './ui/ControlRail'
import { StagePills } from './ui/StagePills'

export function App(): React.JSX.Element {
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
          <Canvas />
          <StagePills />
        </section>
        <ControlRail />
      </main>
    </div>
  )
}
