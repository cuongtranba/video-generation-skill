import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ASSUMPTION (flagged, not a frozen fact): P1 (api-core) has not been written
// yet, so api's dev HTTP port is undetermined. 9999 is a deliberately-obvious
// placeholder, not a guess at the real value — override with
// VITE_API_PROXY_TARGET, and reconcile this default against api's actual dev
// port once P1 is authored. Nothing in this plan's build/test/lint steps
// depends on this value being correct; it only matters for `bun run dev`.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:9999'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true },
      '/media': { target: apiProxyTarget, changeOrigin: true },
    },
  },
})
