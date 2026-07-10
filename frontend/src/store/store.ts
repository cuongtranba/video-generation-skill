import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { foldProject, type ProjectState, type VidgenEvent } from './events'
import type { EventBusClient } from './natsClient'

export type ConnectionState = 'connecting' | 'live' | 'down'

export interface VidgenStore {
  projects: Record<string, ProjectState>
  eventLog: Record<string, VidgenEvent[]>
  connection: ConnectionState
  selectedId?: string
  applyEvent: (subject: string, event: VidgenEvent) => void
  select: (projectId: string) => void
}

export interface VidgenStoreDeps {
  fetchImpl: typeof fetch
  eventBusClient: EventBusClient
}

export function createVidgenStore(deps: VidgenStoreDeps): UseBoundStore<StoreApi<VidgenStore>> {
  // deps.fetchImpl/deps.eventBusClient are unused in this task's slice of the
  // store (thunks land in Task 7, connect/disconnect in Task 8) but are
  // threaded through now so the exported factory signature doesn't change
  // shape across tasks.
  void deps

  return create<VidgenStore>()((set) => ({
    projects: {},
    eventLog: {},
    connection: 'down',
    selectedId: undefined,

    applyEvent: (subject, event) => {
      if (!subject.startsWith(`vidgen.evt.${event.projectId}.`)) {
        console.warn(`applyEvent: subject "${subject}" does not match project "${event.projectId}"`)
      }
      set((state) => {
        const log = [...(state.eventLog[event.projectId] ?? []), event]
        return {
          eventLog: { ...state.eventLog, [event.projectId]: log },
          projects: { ...state.projects, [event.projectId]: foldProject(log) },
        }
      })
    },

    select: (projectId) => set({ selectedId: projectId }),
  }))
}
