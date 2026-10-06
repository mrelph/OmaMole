import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const root = createRoot(document.getElementById('root') as HTMLElement)

if (window.omamole) {
  root.render(
    <StrictMode>
      <App bridge={window.omamole} />
    </StrictMode>
  )
} else {
  root.render(<div style={{ padding: 18 }}>OmaMole needs its Electron shell: run it with <code>pnpm start</code>.</div>)
}
