import type { VidgenEvent } from '../events.js'
import type { EventStore } from '../nats.js'

export function createInMemoryEventStore(seed: VidgenEvent[] = []): EventStore & { events: VidgenEvent[] } {
  const events = [...seed]
  return {
    events,
    async loadEvents(projectId: string): Promise<VidgenEvent[]> {
      return events.filter((e) => e.projectId === projectId)
    },
    async append(event: VidgenEvent): Promise<void> {
      events.push(event)
    },
  }
}
