import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { foldProject, type ProjectState, type VidgenEvent } from './events'
import { createNatsEventBusClient, type EventBusClient } from './natsClient'

export type ConnectionState = 'connecting' | 'live' | 'down'

export interface CreateProjectInput {
  idea: string
  durationSec: number
  sceneCount: number
  tone: string
}

export interface ProjectIdInput {
  projectId: string
}

export interface PublishInput {
  projectId: string
  caption: string
  privacy: string
}

export interface TuneInput {
  projectId: string
  voice?: string
  speed?: number
  captionStyle?: { fontName: string; fontSize: number }
  music?: { search: string; volume: number } | null
}

export interface UploadedAsset {
  filename: string
  sizeBytes: number
}

export interface VidgenStore {
  projects: Record<string, ProjectState>
  eventLog: Record<string, VidgenEvent[]>
  connection: ConnectionState
  selectedId?: string
  applyEvent: (subject: string, event: VidgenEvent) => void
  select: (projectId: string) => void
  createProject: (input: CreateProjectInput) => Promise<void>
  generateScript: (input: ProjectIdInput) => Promise<void>
  resolveMaterial: (input: ProjectIdInput) => Promise<void>
  generateVoiceovers: (input: ProjectIdInput) => Promise<void>
  requestApproval: (input: ProjectIdInput) => Promise<void>
  approveStoryboard: (input: ProjectIdInput) => Promise<void>
  publish: (input: PublishInput) => Promise<void>
  tuneProject: (input: TuneInput) => Promise<void>
  uploadAssets: (projectId: string, files: File[]) => Promise<UploadedAsset[]>
  fetchAssets: (projectId: string) => Promise<UploadedAsset[]>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  /** @internal set by connect(); torn down by disconnect(). Not read by components. */
  _unsubscribe?: () => Promise<void>
}

export interface VidgenStoreDeps {
  fetchImpl: typeof fetch
  eventBusClient: EventBusClient
}

// P4's assumption on wire format (index §5 specifies command names and body
// fields, not the idempotencyKey transport): idempotencyKey rides as an
// extra top-level JSON body field alongside the command's own fields.
// Reconcile against P1's actual command handlers when P1 is authored.
async function postCommand<TBody extends object>(
  fetchImpl: typeof fetch,
  name: string,
  body: TBody,
): Promise<void> {
  const payload = { ...body, idempotencyKey: crypto.randomUUID() }
  const res = await fetchImpl(`/api/commands/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(`command ${name} failed: ${res.status} ${res.statusText}`)
  }
}

export function createVidgenStore(deps: VidgenStoreDeps): UseBoundStore<StoreApi<VidgenStore>> {
  return create<VidgenStore>()((set, get) => ({
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

    createProject: (input) => postCommand(deps.fetchImpl, 'CreateProject', input),
    generateScript: (input) => postCommand(deps.fetchImpl, 'GenerateScript', input),
    resolveMaterial: (input) => postCommand(deps.fetchImpl, 'ResolveMaterial', input),
    generateVoiceovers: (input) => postCommand(deps.fetchImpl, 'GenerateVoiceovers', input),
    requestApproval: (input) => postCommand(deps.fetchImpl, 'RequestApproval', input),
    approveStoryboard: (input) => postCommand(deps.fetchImpl, 'ApproveStoryboard', input),
    publish: (input) => postCommand(deps.fetchImpl, 'Publish', input),
    tuneProject: (input) => postCommand(deps.fetchImpl, 'TuneProject', input),

    uploadAssets: async (projectId, files) => {
      const results: UploadedAsset[] = []
      for (const file of files) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await deps.fetchImpl(`/api/projects/${projectId}/assets`, { method: 'POST', body: fd })
        if (!res.ok) throw new Error(`upload ${file.name} failed: ${res.status}`)
        results.push(await res.json() as UploadedAsset)
      }
      return results
    },

    fetchAssets: async (projectId) => {
      const res = await deps.fetchImpl(`/api/projects/${projectId}/assets`)
      if (!res.ok) throw new Error(`fetchAssets failed: ${res.status}`)
      const data = await res.json() as { assets: UploadedAsset[] }
      return data.assets
    },

    connect: async () => {
      set({ connection: 'connecting' })
      try {
        const unsubscribe = await deps.eventBusClient.consume((subject, event) => {
          get().applyEvent(subject, event)
        })
        set({ connection: 'live', _unsubscribe: unsubscribe })
      } catch (err) {
        set({ connection: 'down' })
        throw err
      }
    },

    disconnect: async () => {
      const unsubscribe = get()._unsubscribe
      set({ connection: 'down', _unsubscribe: undefined })
      if (unsubscribe) {
        await unsubscribe()
      }
    },
  }))
}

const defaultDeps: VidgenStoreDeps = {
  // A wrapper, not a direct `fetch` reference — this keeps the lookup dynamic so
  // tests can reassign `globalThis.fetch = mock(...)` (bun:test has no
  // `vi.stubGlobal`) and have it take effect through the already-constructed
  // singleton. The cast is a boundary assertion: the delegating wrapper behaves
  // as `fetch` but lacks its rarely-used static `preconnect`.
  fetchImpl: ((input, init) => fetch(input, init)) as typeof fetch,
  eventBusClient: createNatsEventBusClient({
    wsUrl: import.meta.env.VITE_NATS_WS_URL ?? 'ws://localhost:8081',
  }),
}

export const useVidgenStore = createVidgenStore(defaultDeps)
