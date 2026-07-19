import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ASSUMPTION (flagged, not a frozen fact): P1 (api-core) has not been written
// yet, so api's dev HTTP port is undetermined. 9999 is a deliberately-obvious
// placeholder, not a guess at the real value — override with
// VITE_API_PROXY_TARGET, and reconcile this default against api's actual dev
// port once P1 is authored. Nothing in this plan's build/test/lint steps
// depends on this value being correct; it only matters for `bun run dev`.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:9999'

// Vite 8.1 + @vitejs/plugin-react 6.0.3 fail to inject the Fast Refresh
// preamble, so $RefreshReg$ is undefined when a component module evaluates.
// This dev-only plugin injects the canonical preamble (identical to the one
// the react plugin ships) so the globals exist before any component runs.
// apply:'serve' keeps it out of the production build, where /@react-refresh
// does not exist.
const reactRefreshPreamble = {
  name: 'react-refresh-preamble-fallback',
  apply: 'serve',
  transformIndexHtml() {
    return [
      {
        tag: 'script',
        attrs: { type: 'module' },
        injectTo: 'head-prepend',
        children: [
          'import RefreshRuntime from "/@react-refresh"',
          'RefreshRuntime.injectIntoGlobalHook(window)',
          'window.$RefreshReg$ = () => {}',
          'window.$RefreshSig$ = () => (type) => type',
        ].join('\n'),
      },
    ]
  },
} as const

export default defineConfig({
  plugins: [react(), reactRefreshPreamble],
  server: {
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true },
      '/media': { target: apiProxyTarget, changeOrigin: true },
    },
  },
})
