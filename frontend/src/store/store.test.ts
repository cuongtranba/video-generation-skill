import { describe, expect, it, mock } from 'bun:test'
import { createVidgenStore, type VidgenStoreDeps } from './store'

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
      idea: 'cats', durationSec: 30, sceneCount: 3, tone: 'fun',
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
      idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun',
    })
    store.getState().applyEvent('vidgen.evt.p2.ProjectCreated', {
      v: 1, type: 'ProjectCreated', projectId: 'p2', at: '2026-01-01T00:00:00Z',
      idea: 'dogs', durationSec: 30, sceneCount: 1, tone: 'fun',
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
