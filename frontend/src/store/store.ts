import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { stepClearedBy, type InFlight, type StepKey } from '../pipeline/derive'
import { foldProject, type ProjectState, type VidgenEvent } from './events'
import { createNatsEventBusClient, type EventBusClient } from './natsClient'

export type ConnectionState = 'connecting' | 'live' | 'down'

/** Session status mirrored from GET /api/session. 'unknown' until the first
 * probe resolves; the SPA gates the board behind 'authenticated'. */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous'

// Active TTS provider, mirrored from the api's GET /api/config (sourced from
// config.yaml). Drives provider-aware UI gating: ElevenLabs ignores the voice
// and speed tune fields, so TunePanel disables them when this is 'elevenlabs'.
export type TtsProvider = 'elevenlabs'

const TTS_PROVIDERS: readonly TtsProvider[] = ['elevenlabs']

function isTtsProvider(value: unknown): value is TtsProvider {
  return typeof value === 'string' && (TTS_PROVIDERS as readonly string[]).includes(value)
}

export interface CreateProjectInput {
  idea: string
  durationSec: number
  sceneCount: number
  tone: string
  language: string
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
  /** Pipeline board node selection, per project (default = derive.activeStep). */
  selectedSteps: Record<string, StepKey>
  /** Commands dispatched whose result event has not landed yet, per project. */
  inFlight: Record<string, InFlight>
  /** Active TTS provider from GET /api/config; undefined until fetchConfig resolves. */
  ttsProvider?: TtsProvider
  /** Session status; the SPA renders the login gate unless 'authenticated'. */
  auth: AuthStatus
  applyEvent: (subject: string, event: VidgenEvent) => void
  select: (projectId: string) => void
  selectStep: (projectId: string, step: StepKey) => void
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
  fetchConfig: () => Promise<void>
  /** Probe GET /api/session and set `auth` accordingly (never throws). */
  checkSession: () => Promise<void>
  /** POST credentials to /api/login; resolves true on success. */
  login: (username: string, password: string) => Promise<boolean>
  /** POST /api/logout and drop to 'anonymous'. */
  logout: () => Promise<void>
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
  return create<VidgenStore>()((set, get) => {
  const setFlags = (projectId: string, steps: StepKey[], value: boolean) =>
    set((state) => {
      const flags: InFlight = { ...state.inFlight[projectId] }
      for (const step of steps) flags[step] = value
      return { inFlight: { ...state.inFlight, [projectId]: flags } }
    })

  // Marks the steps a command drives as in-flight until the matching result
  // event (or RunFailed) lands via applyEvent; a rejected POST rolls back.
  const trackedCommand = async (name: string, input: ProjectIdInput, steps: StepKey[]): Promise<void> => {
    setFlags(input.projectId, steps, true)
    try {
      await postCommand(deps.fetchImpl, name, input)
    } catch (err) {
      setFlags(input.projectId, steps, false)
      throw err
    }
  }

  return {
    projects: {},
    eventLog: {},
    connection: 'down',
    selectedId: undefined,
    selectedSteps: {},
    inFlight: {},
    ttsProvider: undefined,
    auth: 'unknown',

    applyEvent: (subject, event) => {
      if (!subject.startsWith(`vidgen.evt.${event.projectId}.`)) {
        console.warn(`applyEvent: subject "${subject}" does not match project "${event.projectId}"`)
      }
      set((state) => {
        const log = [...(state.eventLog[event.projectId] ?? []), event]
        const cleared = stepClearedBy(event)
        const flags = state.inFlight[event.projectId]
        const inFlight = cleared && flags?.[cleared]
          ? { ...state.inFlight, [event.projectId]: { ...flags, [cleared]: false } }
          : state.inFlight
        return {
          eventLog: { ...state.eventLog, [event.projectId]: log },
          projects: { ...state.projects, [event.projectId]: foldProject(log) },
          inFlight,
        }
      })
    },

    select: (projectId) => set({ selectedId: projectId }),

    selectStep: (projectId, step) =>
      set((state) => ({ selectedSteps: { ...state.selectedSteps, [projectId]: step } })),

    createProject: (input) => postCommand(deps.fetchImpl, 'CreateProject', input),
    generateScript: (input) => trackedCommand('GenerateScript', input, ['script']),
    resolveMaterial: (input) => trackedCommand('ResolveMaterial', input, ['material']),
    generateVoiceovers: (input) => trackedCommand('GenerateVoiceovers', input, ['voice', 'captions']),
    requestApproval: (input) => postCommand(deps.fetchImpl, 'RequestApproval', input),
    approveStoryboard: (input) => trackedCommand('ApproveStoryboard', input, ['render']),
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

    fetchConfig: async () => {
      const res = await deps.fetchImpl('/api/config')
      if (!res.ok) throw new Error(`GET /api/config failed: ${res.status} ${res.statusText}`)
      const body: unknown = await res.json()
      const provider = isTtsProvider((body as { ttsProvider?: unknown })?.ttsProvider)
        ? (body as { ttsProvider: TtsProvider }).ttsProvider
        : undefined
      set({ ttsProvider: provider })
    },

    checkSession: async () => {
      try {
        const res = await deps.fetchImpl('/api/session')
        if (!res.ok) {
          set({ auth: 'anonymous' })
          return
        }
        const body: unknown = await res.json()
        const authed = (body as { authenticated?: unknown })?.authenticated === true
        set({ auth: authed ? 'authenticated' : 'anonymous' })
        if (authed) void get().fetchConfig().catch(() => undefined)
      } catch {
        set({ auth: 'anonymous' })
      }
    },

    login: async (username, password) => {
      const res = await deps.fetchImpl('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        set({ auth: 'anonymous' })
        return false
      }
      set({ auth: 'authenticated' })
      void get().fetchConfig().catch(() => undefined)
      return true
    },

    logout: async () => {
      try {
        await deps.fetchImpl('/api/logout', { method: 'POST' })
      } catch {
        // Best-effort: even if the request fails, drop the local session.
      }
      set({ auth: 'anonymous' })
    },
  }
  })
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
