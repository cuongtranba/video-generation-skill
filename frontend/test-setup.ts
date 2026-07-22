import { GlobalRegistrator } from '@happy-dom/global-registrator'
import '@testing-library/jest-dom'
import { afterEach } from 'bun:test'

GlobalRegistrator.register()

// Import RTL only AFTER happy-dom has registered the DOM globals: @testing-
// library/dom's `screen` binds to `document` at module-eval time, and static
// imports hoist above the register() call above, so a static import here would
// evaluate screen with no document and make every screen.* query throw.
const { cleanup } = await import('@testing-library/react')

// Initialize i18next once for the whole suite (dynamic, post-register). Without
// this the useTranslation() hook has no active instance and t() returns raw
// keys. Tests run in the product default language (Vietnamese).
await import('./src/i18n')

// bun:test does not auto-register RTL cleanup the way Jest/Vitest do, so
// unmounted components would otherwise persist across tests in the same file —
// staying subscribed to the zustand store and re-rendering on setState, which
// produces duplicate DOM matches. Register it once here.
afterEach(cleanup)
