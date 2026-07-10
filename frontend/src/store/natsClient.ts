import { wsconnect } from '@nats-io/nats-core'
import { jetstream } from '@nats-io/jetstream'
import type { VidgenEvent } from './events'

/** The narrow surface store.ts needs from nats.ws — small enough to fake in tests. */
export interface EventBusClient {
  /**
   * Subscribes to VIDGEN_EVENTS and invokes onEvent for each message,
   * decoded straight into a typed VidgenEvent (no runtime schema
   * validation — out of scope for P4, events are trusted per the frozen
   * contract in index §4). Resolves once the subscription is live and
   * returns a teardown function.
   */
  consume(onEvent: (subject: string, event: VidgenEvent) => void): Promise<() => Promise<void>>
}

export interface EventBusClientOptions {
  wsUrl: string
}

/**
 * Real nats.ws implementation. Verified pattern (Context7 + D3 checkpoint):
 * wsconnect (from @nats-io/nats-core, NOT @nats-io/transport-node) +
 * jetstream + js.consumers.get('VIDGEN_EVENTS') with no name arg (ordered
 * ephemeral consumer) + c.consume({ callback }).
 */
export function createNatsEventBusClient(opts: EventBusClientOptions): EventBusClient {
  return {
    async consume(onEvent) {
      const nc = await wsconnect({ servers: opts.wsUrl })
      const js = jetstream(nc)
      const consumer = await js.consumers.get('VIDGEN_EVENTS')
      await consumer.consume({
        callback: (m) => {
          onEvent(m.subject, m.json<VidgenEvent>())
          m.ack()
        },
      })
      return async () => {
        await nc.close()
      }
    },
  }
}
