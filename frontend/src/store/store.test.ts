import { describe, expect, it, mock } from 'bun:test'
import { createVidgenStore, type VidgenStoreDeps, type TuneInput, type UploadedAsset } from './store'
import type { EventBusClient } from './natsClient'
import type { VidgenEvent as VidgenEventType } from './events'

function fakeDeps(overrides: Partial<VidgenStoreDeps> = {}): VidgenStoreDeps {
  return {
    fetchImpl: mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
    eventBusClient: {
      consume: mock(async () => async () => {}),
    },
    ...overrides,
  }
}

describe('applyEvent', () => {
  it('folds events for a project incrementally', () => {
    const store = createVidgenStore(fakeDeps())
    store.getState().applyEvent('vidgen.evt.p1.ProjectCreated', {
      v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-01-01T00:00:00Z',
      idea: 'cats', durationSec: 30, sceneCount: 3, tone: 'fun', language: 'English',
    })
    store.getState().applyEvent('vidgen.evt.p1.ScriptGenerated', {
      v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-01-01T00:00:01Z',
      scenes: [{ idx: 0, narration: 'n', visual: 'v' }], scriptUsd: 0,
    })
    const project = store.getState().projects.p1
    expect(project.status).toBe('scripted')
    expect(project.scenes).toHaveLength(1)
    expect(project.spentUsd).toBe(0)
  })

  it('keeps two projects independent', () => {
    const store = createVidgenStore(fakeDeps())
    store.getState().applyEvent('vidgen.evt.p1.ProjectCreated', {
      v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-01-01T00:00:00Z',
      idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun', language: 'English',
    })
    store.getState().applyEvent('vidgen.evt.p2.ProjectCreated', {
      v: 1, type: 'ProjectCreated', projectId: 'p2', at: '2026-01-01T00:00:00Z',
      idea: 'dogs', durationSec: 30, sceneCount: 1, tone: 'fun', language: 'English',
    })
    expect(Object.keys(store.getState().projects).sort()).toEqual(['p1', 'p2'])
  })
})

describe('select', () => {
  it('sets selectedId', () => {
    const store = createVidgenStore(fakeDeps())
    store.getState().select('p1')
    expect(store.getState().selectedId).toBe('p1')
  })
})

describe('command thunks', () => {
  it('createProject posts to /api/commands/CreateProject with the body fields plus an idempotencyKey', async () => {
    const fetchImpl = mock(async () => new Response(null, { status: 200 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    await store.getState().createProject({ idea: 'cats', durationSec: 30, sceneCount: 3, tone: 'fun', language: 'English' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/commands/CreateProject')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.idea).toBe('cats')
    expect(body.durationSec).toBe(30)
    expect(typeof body.idempotencyKey).toBe('string')
  })

  it.each([
    ['generateScript', 'GenerateScript', { projectId: 'p1' }],
    ['resolveMaterial', 'ResolveMaterial', { projectId: 'p1' }],
    ['generateVoiceovers', 'GenerateVoiceovers', { projectId: 'p1' }],
    ['requestApproval', 'RequestApproval', { projectId: 'p1' }],
    ['approveStoryboard', 'ApproveStoryboard', { projectId: 'p1' }],
    ['publish', 'Publish', { projectId: 'p1', caption: 'hi', privacy: 'public' }],
  ] as const)('%s posts to /api/commands/%s', async (action, path, input) => {
    const fetchImpl = mock(async () => new Response(null, { status: 200 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    await (store.getState()[action] as (i: typeof input) => Promise<void>)(input)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`/api/commands/${path}`)
  })

  it('rejects when the server responds non-2xx', async () => {
    const fetchImpl = mock(async () => new Response('conflict', { status: 409 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    await expect(store.getState().approveStoryboard({ projectId: 'p1' })).rejects.toThrow(/409/)
  })
})

describe('connect/disconnect', () => {
  it('goes live and applies events delivered by the event bus', async () => {
    const event: VidgenEventType = {
      v: 1, type: 'AwaitingApproval', projectId: 'p1', at: '2026-01-01T00:00:00Z',
    }
    const unsubscribe = mock(async () => {})
    const eventBusClient: EventBusClient = {
      consume: mock(async (onEvent) => {
        onEvent('vidgen.evt.p1.AwaitingApproval', event)
        return unsubscribe
      }),
    }
    const store = createVidgenStore(fakeDeps({ eventBusClient }))

    await store.getState().connect()

    expect(store.getState().connection).toBe('live')
    expect(store.getState().projects.p1.status).toBe('awaiting_approval')

    await store.getState().disconnect()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(store.getState().connection).toBe('down')
  })

  it('marks the connection down and rethrows when the event bus fails to connect', async () => {
    const eventBusClient: EventBusClient = {
      consume: mock(async () => {
        throw new Error('ws refused')
      }),
    }
    const store = createVidgenStore(fakeDeps({ eventBusClient }))
    await expect(store.getState().connect()).rejects.toThrow('ws refused')
    expect(store.getState().connection).toBe('down')
  })
})

describe('tuneProject', () => {
  it('posts TuneProject command with correct URL and body fields', async () => {
    const fetchImpl = mock(async () => new Response('{}', { status: 200 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    const input: TuneInput = { projectId: 'p1', voice: 'lannhi', speed: 1 }
    await store.getState().tuneProject(input)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/commands/TuneProject')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.projectId).toBe('p1')
    expect(body.voice).toBe('lannhi')
    expect(body.speed).toBe(1)
    expect(typeof body.idempotencyKey).toBe('string')
  })
})

describe('uploadAssets', () => {
  it('posts files to /api/projects/:id/assets and returns UploadedAsset[]', async () => {
    const asset: UploadedAsset = { filename: 'a.mp4', sizeBytes: 100 }
    const fetchImpl = mock(async () => new Response(JSON.stringify(asset), { status: 200 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    const file = new File(['content'], 'a.mp4', { type: 'video/mp4' })
    const results = await store.getState().uploadAssets('p1', [file])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/projects/p1/assets')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
    expect(results).toHaveLength(1)
    expect(results[0]?.filename).toBe('a.mp4')
    expect(results[0]?.sizeBytes).toBe(100)
  })

  it('throws on non-ok response', async () => {
    const fetchImpl = mock(async () => new Response('fail', { status: 500 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    const file = new File(['x'], 'b.mp4', { type: 'video/mp4' })
    await expect(store.getState().uploadAssets('p1', [file])).rejects.toThrow(/500/)
  })
})

describe('fetchAssets', () => {
  it('GETs /api/projects/:id/assets and returns the assets array', async () => {
    const assets: UploadedAsset[] = [{ filename: 'clip.mp4', sizeBytes: 999 }]
    const fetchImpl = mock(async () => new Response(JSON.stringify({ assets }), { status: 200 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    const result = await store.getState().fetchAssets('p1')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(url).toBe('/api/projects/p1/assets')
    // GET — no method override expected
    expect(init?.method).toBeUndefined()
    expect(result).toHaveLength(1)
    expect(result[0]?.filename).toBe('clip.mp4')
    expect(result[0]?.sizeBytes).toBe(999)
  })

  it('throws on non-ok response', async () => {
    const fetchImpl = mock(async () => new Response('not found', { status: 404 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    await expect(store.getState().fetchAssets('p1')).rejects.toThrow(/404/)
  })
})

describe('fetchConfig', () => {
  it('stores a valid ttsProvider from GET /api/config', async () => {
    const fetchImpl = mock(async () => new Response(JSON.stringify({ ttsProvider: 'elevenlabs' }), { status: 200 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    await store.getState().fetchConfig()
    expect(fetchImpl).toHaveBeenCalledWith('/api/config')
    expect(store.getState().ttsProvider).toBe('elevenlabs')
  })

  it('ignores an unrecognized provider (leaves ttsProvider undefined)', async () => {
    const fetchImpl = mock(async () => new Response(JSON.stringify({ ttsProvider: 'azure' }), { status: 200 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    await store.getState().fetchConfig()
    expect(store.getState().ttsProvider).toBeUndefined()
  })

  it('throws on a non-200 response', async () => {
    const fetchImpl = mock(async () => new Response(null, { status: 500 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    await expect(store.getState().fetchConfig()).rejects.toThrow(/GET \/api\/config failed/)
  })
})
