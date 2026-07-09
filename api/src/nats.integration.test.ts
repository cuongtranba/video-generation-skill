import { describe, it, expect } from 'bun:test'
import { connectBus, ensureStreams, EVENTS_STREAM, JOBS_STREAM, publishEvent, dispatchJob, type Bus } from './nats.js'
import { ensureDurableConsumer, deleteDurableConsumer, consumeEvents, createEventStore } from './nats.js'
import { randomUUID } from 'node:crypto'
import { AckPolicy } from '@nats-io/jetstream'
import type { VidgenEvent } from './events.js'

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

describe('publishEvent + dispatchJob (integration)', () => {
  it.skipIf(!up)('republishing the same event does not double-append (dupe window)', async () => {
    const bus = await tryConnectBus()
    if (!bus) return
    await ensureStreams(bus.jsm)
    const projectId = randomUUID()
    const event: VidgenEvent = { v: 1, type: 'AwaitingApproval', projectId, at: 't' }
    await publishEvent(bus.js, event)
    await publishEvent(bus.js, event)
    const consumer = await bus.js.consumers.get(EVENTS_STREAM, { filter_subjects: [`vidgen.evt.${projectId}.AwaitingApproval`] })
    const batch = await consumer.fetch({ max_messages: 10, expires: 1500 })
    let count = 0
    for await (const m of batch) {
      count++
      m.ack()
    }
    expect(count).toBe(1)
    await bus.nc.drain()
  })

  it.skipIf(!up)('dispatchJob publishes to vidgen.job.<kind>.<projectId>.<scene>', async () => {
    const bus = await tryConnectBus()
    if (!bus) return
    await ensureStreams(bus.jsm)
    const projectId = randomUUID()
    await dispatchJob(bus.js, 'material', projectId, 0, { visual: 'b' })
    // VIDGEN_JOBS is Workqueue-retention (index.md §4). An ordered consumer
    // (js.consumers.get(stream, { filter_subjects })) forces AckPolicy.None,
    // which JetStream rejects for pull consumers on a Workqueue stream
    // ("consumer in pull mode requires ack policy") — so verify via an
    // explicit-ack ephemeral pull consumer instead.
    const consumerName = `test-dispatch-${projectId}`
    await bus.jsm.consumers.add(JOBS_STREAM, {
      name: consumerName,
      filter_subject: `vidgen.job.material.${projectId}.0`,
      ack_policy: AckPolicy.Explicit,
    })
    const consumer = await bus.js.consumers.get(JOBS_STREAM, consumerName)
    const batch = await consumer.fetch({ max_messages: 1, expires: 1500 })
    const seen: string[] = []
    for await (const m of batch) {
      seen.push(m.subject)
      m.ack()
    }
    expect(seen).toEqual([`vidgen.job.material.${projectId}.0`])
    await bus.jsm.consumers.delete(JOBS_STREAM, consumerName)
    await bus.nc.drain()
  })
})

describe('durable consumer + createEventStore (integration)', () => {
  it.skipIf(!up)('createEventStore loads a project log in stream order', async () => {
    const bus = await tryConnectBus()
    if (!bus) return
    await ensureStreams(bus.jsm)
    const projectId = randomUUID()
    const created: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId, at: '2026-07-09T00:00:00Z', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' }
    const scripted: VidgenEvent = { v: 1, type: 'ScriptGenerated', projectId, at: '2026-07-09T00:01:00Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 }
    await publishEvent(bus.js, created)
    await publishEvent(bus.js, scripted)
    const store = createEventStore(bus.js)
    const events = await store.loadEvents(projectId)
    expect(events.map((e) => e.type)).toEqual(['ProjectCreated', 'ScriptGenerated'])
    await bus.nc.drain()
  })

  it.skipIf(!up)('consumeEvents on a durable consumer delivers backlog and new events', async () => {
    const bus = await tryConnectBus()
    if (!bus) return
    await ensureStreams(bus.jsm)
    const projectId = randomUUID()
    const durable = `test-consume-${projectId}`
    const event: VidgenEvent = { v: 1, type: 'AwaitingApproval', projectId, at: 't' }
    await publishEvent(bus.js, event)
    await ensureDurableConsumer(bus.jsm, durable)
    const seen: VidgenEvent[] = []
    const consumePromise = consumeEvents(bus.js, durable, async (e) => {
      seen.push(e)
    })
    consumePromise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(seen.some((e) => e.projectId === projectId && e.type === 'AwaitingApproval')).toBe(true)
    await deleteDurableConsumer(bus.jsm, durable)
    await bus.nc.drain()
  })
})
