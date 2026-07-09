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
