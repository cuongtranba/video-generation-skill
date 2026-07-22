import { describe, expect, it, mock } from 'bun:test'
import { createVidgenStore, type VidgenStoreDeps } from './store'

function fakeDeps(overrides: Partial<VidgenStoreDeps> = {}): VidgenStoreDeps {
  return {
    fetchImpl: mock(async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
    eventBusClient: { consume: mock(async () => async () => {}) },
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('checkSession', () => {
  it('sets authenticated when the probe returns authenticated:true', async () => {
    const fetchImpl = mock(async () => jsonResponse({ authenticated: true }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    await store.getState().checkSession()
    expect(store.getState().auth).toBe('authenticated')
    expect(fetchImpl).toHaveBeenCalledWith('/api/session')
  })

  it('sets anonymous when the probe returns authenticated:false', async () => {
    const fetchImpl = mock(async () => jsonResponse({ authenticated: false }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    await store.getState().checkSession()
    expect(store.getState().auth).toBe('anonymous')
  })

  it('sets anonymous when the probe rejects', async () => {
    const fetchImpl = mock(async () => {
      throw new Error('network down')
    })
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    await store.getState().checkSession()
    expect(store.getState().auth).toBe('anonymous')
  })
})

describe('login', () => {
  it('posts credentials and flips to authenticated on success', async () => {
    const fetchImpl = mock(async (url: string) =>
      url === '/api/login' ? jsonResponse({ authenticated: true }) : jsonResponse({ ttsProvider: 'elevenlabs' }),
    )
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    const ok = await store.getState().login('admin', 'secret')
    expect(ok).toBe(true)
    expect(store.getState().auth).toBe('authenticated')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/login')
    expect(JSON.parse(init.body as string)).toEqual({ username: 'admin', password: 'secret' })
  })

  it('returns false and stays anonymous on a 401', async () => {
    const fetchImpl = mock(async () => jsonResponse({ authenticated: false }, 401))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    const ok = await store.getState().login('admin', 'wrong')
    expect(ok).toBe(false)
    expect(store.getState().auth).toBe('anonymous')
  })
})

describe('logout', () => {
  it('posts to /api/logout and drops to anonymous', async () => {
    const fetchImpl = mock(async () => new Response(null, { status: 200 }))
    const store = createVidgenStore(fakeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }))
    store.setState({ auth: 'authenticated' })
    await store.getState().logout()
    expect(store.getState().auth).toBe('anonymous')
    expect(fetchImpl).toHaveBeenCalledWith('/api/logout', { method: 'POST' })
  })
})
