import { createPool, migrate } from './db.js'
import { connectBus, ensureStreams, createEventStore } from './nats.js'
import { createCommandContext } from './commands.js'
import { runProjections } from './projections.js'
import { createHttpServer } from './http.js'
import { sdkScriptGenerator } from './script.js'
import { costCapFromEnv } from './cost.js'
import { loadTtsProvider } from './config.js'
import { authConfigFromEnv } from './auth.js'

async function main(): Promise<void> {
  const natsServers = process.env.NATS_URL ?? 'nats://localhost:4223'
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://vidgen:vidgen@localhost:5433/vidgen'
  const port = Number(process.env.PORT ?? 8080)
  const spaDir = process.env.SPA_DIR ?? 'public'
  const mediaDir = process.env.MEDIA_DIR ?? 'media'
  const ttsProvider = await loadTtsProvider(process.env.CONFIG_PATH ?? 'config.yaml')
  const auth = authConfigFromEnv(process.env)

  const db = createPool(databaseUrl)
  await migrate(db)

  const bus = await connectBus(natsServers)
  await ensureStreams(bus.jsm)

  const store = createEventStore(bus.js)
  const ctx = createCommandContext(store, bus.js, sdkScriptGenerator, costCapFromEnv(), mediaDir)

  runProjections(bus.js, bus.jsm, db).catch((err: unknown) => {
    console.error('projections consumer stopped:', err)
    process.exit(1)
  })

  const server = createHttpServer({ db, ctx, spaDir, mediaDir, ttsProvider, auth })
  server.listen(port, () => {
    console.log(`api listening on :${port}`)
  })
}

main().catch((err: unknown) => {
  console.error('fatal:', err)
  process.exit(1)
})
