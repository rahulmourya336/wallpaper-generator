import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const host = document.getElementById('root')
if (!host) throw new Error('#root missing')

const root = createRoot(host)

// Dev-only contact sheet. Tree-shaken out of the production bundle because the
// import is behind a statically false condition.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('sheet')) {
  void import('./dev/ContactSheet').then(({ ContactSheet }) => {
    root.render(<ContactSheet />)
  })
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
