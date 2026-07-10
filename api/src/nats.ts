import { connect, type NatsConnection } from '@nats-io/transport-node'
import {
  jetstream,
  jetstreamManager,
  RetentionPolicy,
  StorageType,
  type JetStreamClient,
  type JetStreamManager,
  type StreamConfig,
} from '@nats-io/jetstream'

export const EVENTS_STREAM = 'VIDGEN_EVENTS'
export const JOBS_STREAM = 'VIDGEN_JOBS'
/** Matches index.md §4 "dupe-window 2m" — 2 minutes in nanoseconds. */
export const DUPLICATE_WINDOW_NS = 2 * 60 * 1_000_000_000

export interface Bus {
  nc: NatsConnection
  js: JetStreamClient
  jsm: JetStreamManager
}

export async function connectBus(servers: string): Promise<Bus> {
  const nc = await connect({ servers })
  const js = jetstream(nc)
  const jsm = await jetstreamManager(nc)
  return { nc, js, jsm }
}

async function ensureStream(jsm: JetStreamManager, config: Partial<StreamConfig> & { name: string }): Promise<void> {
  try {
    await jsm.streams.info(config.name)
  } catch {
    await jsm.streams.add(config)
  }
}

export async function ensureStreams(jsm: JetStreamManager): Promise<void> {
  await ensureStream(jsm, {
    name: EVENTS_STREAM,
    subjects: ['vidgen.evt.>'],
    retention: RetentionPolicy.Limits,
    storage: StorageType.File,
    duplicate_window: DUPLICATE_WINDOW_NS,
  })
  await ensureStream(jsm, {
    name: JOBS_STREAM,
    subjects: ['vidgen.job.>'],
    retention: RetentionPolicy.Workqueue,
    storage: StorageType.File,
    duplicate_window: DUPLICATE_WINDOW_NS, // index.md §4 freezes dupe-window 2m for both streams — codify it, don't rely on the NATS default
  })
}

import type { VidgenEvent } from './events.js'

export type JobKind = 'material' | 'tts' | 'caption' | 'render'

/** Minimal publish capability — satisfied by the real JetStreamClient and by
 * test fakes, so command-handler unit tests never need a live NATS server. */
export interface Publisher {
  publish(subject: string, data: string, opts?: { msgID?: string }): Promise<unknown>
}

/** Deterministic per-fact id (index.md §4): `<type>-<projectId>-<sceneIdx|'-'>`.
 * The stream's 2-minute dupe window collapses repeated publishes of the same
 * logical fact into a single stored event, so worker/command retries never
 * double-append. */
export function eventId(event: VidgenEvent): string {
  if (event.type === 'StyleSet') return `StyleSet-${event.projectId}-${event.uid}`
  const sceneIdx = 'sceneIdx' in event ? String(event.sceneIdx) : '-'
  return `${event.type}-${event.projectId}-${sceneIdx}`
}

export function eventSubject(event: VidgenEvent): string {
  return `vidgen.evt.${event.projectId}.${event.type}`
}

export async function publishEvent(js: Publisher, event: VidgenEvent): Promise<void> {
  await js.publish(eventSubject(event), JSON.stringify(event), { msgID: eventId(event) })
}

export function jobSubject(kind: JobKind, projectId: string, sceneIdx: number | null): string {
  const scene = sceneIdx === null ? '-' : String(sceneIdx)
  return `vidgen.job.${kind}.${projectId}.${scene}`
}

export interface JobPayload {
  projectId: string
  sceneIdx: number | null
  [key: string]: unknown
}

export async function dispatchJob(
  js: Publisher,
  kind: JobKind,
  projectId: string,
  sceneIdx: number | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const scene = sceneIdx === null ? '-' : String(sceneIdx)
  const body: JobPayload = { projectId, sceneIdx, ...payload }
  await js.publish(jobSubject(kind, projectId, sceneIdx), JSON.stringify(body), { msgID: `${kind}-${projectId}-${scene}` })
}

import { AckPolicy, DeliverPolicy } from '@nats-io/jetstream'

export async function ensureDurableConsumer(jsm: JetStreamManager, durableName: string): Promise<void> {
  try {
    await jsm.consumers.info(EVENTS_STREAM, durableName)
  } catch {
    await jsm.consumers.add(EVENTS_STREAM, {
      durable_name: durableName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
    })
  }
}

export async function deleteDurableConsumer(jsm: JetStreamManager, durableName: string): Promise<void> {
  try {
    await jsm.consumers.delete(EVENTS_STREAM, durableName)
  } catch {
    // already gone — fine
  }
}

/** Long-running: resolves only when the underlying subscription ends (e.g.
 * on nc.drain()). Callers run this as a background loop, not awaited inline. */
export async function consumeEvents(
  js: JetStreamClient,
  durableName: string,
  handler: (event: VidgenEvent, seq: number) => Promise<void>,
): Promise<void> {
  const c = await js.consumers.get(EVENTS_STREAM, durableName)
  const msgs = await c.consume()
  for await (const m of msgs) {
    try {
      const event = m.json<VidgenEvent>()
      await handler(event, m.seq)
      m.ack()
    } catch (err) {
      console.error(`consumeEvents: handler failed for seq ${m.seq}:`, err)
      m.nak()
    }
  }
}

export interface EventStore {
  loadEvents(projectId: string): Promise<VidgenEvent[]>
  append(event: VidgenEvent): Promise<void>
}

/** Reads a project's log directly from VIDGEN_EVENTS (the source of truth),
 * via an ephemeral ordered consumer filtered to that project's subjects. */
export function createEventStore(js: JetStreamClient): EventStore {
  return {
    async loadEvents(projectId: string): Promise<VidgenEvent[]> {
      const consumer = await js.consumers.get(EVENTS_STREAM, { filter_subjects: [`vidgen.evt.${projectId}.>`] })
      const events: VidgenEvent[] = []
      const batch = await consumer.fetch({ max_messages: 10_000, expires: 1000 }) // @nats-io/jetstream@3.4.0 requires expires >= 1000ms
      for await (const m of batch) {
        events.push(m.json<VidgenEvent>())
      }
      return events
    },
    async append(event: VidgenEvent): Promise<void> {
      await publishEvent(js, event)
    },
  }
}
