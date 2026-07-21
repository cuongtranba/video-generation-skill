import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/index.css'
import App from './App'
import { useVidgenStore } from './store/store'

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

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('#root element not found')
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
