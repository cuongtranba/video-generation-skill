import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useVidgenStore } from './store/store'
import './i18n'
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

// Probe the session on bootstrap: this resolves `auth` from 'unknown' to
// 'authenticated' | 'anonymous', which gates the login screen vs the board.
// On success it also fetches the api config (provider-aware controls) — kept
// behind auth so an anonymous visitor never hits the gated /api/config.
useVidgenStore
  .getState()
  .checkSession()
  .catch((err: unknown) => {
    console.error('failed to probe session', err)
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
