import { describe, it, expect } from 'bun:test'
import { connectBus, ensureStreams, EVENTS_STREAM, JOBS_STREAM, type Bus } from './nats.js'

const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4223'

async function tryConnectBus(): Promise<Bus | null> {
  try {
    return await connectBus(NATS_URL)
  } catch {
    return null
  }
}

// Probe NATS reachability once at module load so tests can be skipped
// cleanly (no local NATS at NATS_URL); each test below still calls
// tryConnectBus() itself since it drains the connection it gets.
const probeBus = await tryConnectBus()
const up = probeBus !== null
await probeBus?.nc.drain()

describe('connectBus + ensureStreams (integration)', () => {
  it.skipIf(!up)('creates VIDGEN_EVENTS and VIDGEN_JOBS, and is idempotent', async () => {
    const bus = await tryConnectBus()
    if (!bus) return
    await ensureStreams(bus.jsm)
    await ensureStreams(bus.jsm) // second call must not throw
    const events = await bus.jsm.streams.info(EVENTS_STREAM)
    const jobs = await bus.jsm.streams.info(JOBS_STREAM)
    expect(events.config.name).toBe(EVENTS_STREAM)
    expect(events.config.subjects).toEqual(['vidgen.evt.>'])
    expect(jobs.config.name).toBe(JOBS_STREAM)
    expect(jobs.config.subjects).toEqual(['vidgen.job.>'])
    await bus.nc.drain()
  })
})
