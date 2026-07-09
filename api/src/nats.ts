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
