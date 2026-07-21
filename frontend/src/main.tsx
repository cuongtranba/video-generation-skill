import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useVidgenStore } from './store/store'
import './styles/tokens.css'
import './styles/app.css'

// Connect once at bootstrap — never inside a component. This is the one place
// the app opens the nats.ws event stream: all side effects live in the store
// layer (store.ts), and components only read selectors / dispatch thunks, so
// this connect() cannot end up duplicated inside src/components/**.
useVidgenStore
  .getState()
  .connect()
  .catch((err: unknown) => {
    console.error('failed to connect to the event stream', err)
  })

// Fetch the active TTS provider so provider-aware controls (TunePanel voice /
// speed) render correctly. Independent of the event stream — a failure here
// only leaves the voice controls enabled, never blocks the board.
useVidgenStore
  .getState()
  .fetchConfig()
  .catch((err: unknown) => {
    console.error('failed to fetch api config', err)
  })

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element not found')
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
