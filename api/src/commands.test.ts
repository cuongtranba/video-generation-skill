import { describe, it, expect } from 'bun:test'
import { createInMemoryEventStore } from './testutil/inMemoryEventStore.js'
import type { Publisher } from './nats.js'
import type { Scene } from './events.js'
import { createCommandContext, createProject, type ScriptGenerator } from './commands.js'
import { generateScript } from './commands.js'
import { InvalidTransitionError, ProjectNotFoundError } from './aggregate.js'
import { resolveMaterial, generateVoiceovers } from './commands.js'
import { CostCapExceededError } from './cost.js'
import { requestApproval, approveStoryboard } from './commands.js'

function fakePublisher(): Publisher & { published: Array<{ subject: string; data: string; msgID?: string }> } {
  const published: Array<{ subject: string; data: string; msgID?: string }> = []
  return {
    published,
    async publish(subject, data, opts) {
      published.push({ subject, data, msgID: opts?.msgID })
      return undefined
    },
  }
}

const fixedScriptGen: ScriptGenerator = {
  async generateScenes(): Promise<{ scenes: Scene[] }> {
    return { scenes: [{ idx: 0, narration: 'a', visual: 'b' }] }
  },
}

describe('createProject', () => {
  it('appends ProjectCreated and publishes it', async () => {
    const store = createInMemoryEventStore()
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const { projectId } = await createProject(ctx, { idea: 'nước ấm', durationSec: 30, sceneCount: 3, tone: 'casual' })
    expect(store.events).toHaveLength(1)
    expect(store.events[0]).toMatchObject({ type: 'ProjectCreated', projectId, idea: 'nước ấm', durationSec: 30, sceneCount: 3, tone: 'casual' })
    expect(js.published).toHaveLength(1)
    expect(js.published[0]?.subject).toBe(`vidgen.evt.${projectId}.ProjectCreated`)
  })
})

describe('generateScript', () => {
  it('appends ScriptGenerated with scriptUsd forced to 0, regardless of what the generator reports', async () => {
    const store = createInMemoryEventStore([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'nước ấm', durationSec: 30, sceneCount: 1, tone: 'casual' },
    ])
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const state = await generateScript(ctx, { projectId: 'p1' })
    expect(state.status).toBe('scripted')
    expect(state.scenes).toEqual([{ idx: 0, narration: 'a', visual: 'b' }])
    const appended = store.events.at(-1)
    expect(appended).toMatchObject({ type: 'ScriptGenerated', scriptUsd: 0 })
  })

  it('rejects a project that does not exist', async () => {
    const store = createInMemoryEventStore()
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15)
    await expect(generateScript(ctx, { projectId: 'missing' })).rejects.toThrow(ProjectNotFoundError)
  })

  it('rejects a project that is already scripted', async () => {
    const store = createInMemoryEventStore([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
      { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: 't1', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 },
    ])
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15)
    await expect(generateScript(ctx, { projectId: 'p1' })).rejects.toThrow(InvalidTransitionError)
  })
})

const scriptedEvents = [
  { v: 1 as const, type: 'ProjectCreated' as const, projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 2, tone: 'casual' },
  {
    v: 1 as const,
    type: 'ScriptGenerated' as const,
    projectId: 'p1',
    at: 't1',
    scenes: [
      { idx: 0, narration: 'scene zero narration', visual: 'a' },
      { idx: 1, narration: 'scene one narration', visual: 'b' },
    ],
    scriptUsd: 0,
  },
]

const materialEvents = [
  ...scriptedEvents,
  { v: 1 as const, type: 'MaterialResolved' as const, projectId: 'p1', at: 't2', sceneIdx: 0, source: 'pexels', assetPath: '/m/0.mp4' },
  { v: 1 as const, type: 'MaterialResolved' as const, projectId: 'p1', at: 't3', sceneIdx: 1, source: 'pexels', assetPath: '/m/1.mp4' },
]

describe('resolveMaterial', () => {
  it('dispatches one material job per scene and appends no event', async () => {
    const store = createInMemoryEventStore(scriptedEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const before = store.events.length
    await resolveMaterial(ctx, { projectId: 'p1' })
    expect(store.events).toHaveLength(before)
    expect(js.published.map((m) => m.subject)).toEqual(['vidgen.job.material.p1.0', 'vidgen.job.material.p1.1'])
  })
})

describe('generateVoiceovers', () => {
  it('appends CostProjected then dispatches tts and caption jobs when under the cap', async () => {
    const store = createInMemoryEventStore(materialEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const state = await generateVoiceovers(ctx, { projectId: 'p1' })
    expect(state.status).toBe('material') // CostProjected does not change status
    expect(store.events.at(-1)).toMatchObject({ type: 'CostProjected', capUsd: 0.15 })
    expect(js.published.map((m) => m.subject)).toEqual([
      'vidgen.evt.p1.CostProjected',
      'vidgen.job.tts.p1.0',
      'vidgen.job.tts.p1.1',
      'vidgen.job.caption.p1.0',
      'vidgen.job.caption.p1.1',
    ])
  })

  it('vetoes when projected cost exceeds the cap — no event, no jobs', async () => {
    const store = createInMemoryEventStore(materialEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.00001) // cap far below 2 scenes of TTS
    await expect(generateVoiceovers(ctx, { projectId: 'p1' })).rejects.toThrow(CostCapExceededError)
    expect(store.events).toHaveLength(materialEvents.length)
    expect(js.published).toHaveLength(0)
  })
})

describe('requestApproval', () => {
  it('appends AwaitingApproval', async () => {
    const store = createInMemoryEventStore(materialEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const state = await requestApproval(ctx, { projectId: 'p1' })
    expect(state.status).toBe('awaiting_approval')
    expect(js.published.map((m) => m.subject)).toEqual(['vidgen.evt.p1.AwaitingApproval'])
  })
})

describe('approveStoryboard', () => {
  it('appends ApprovalGranted and dispatches a render job', async () => {
    const events = [...materialEvents, { v: 1 as const, type: 'AwaitingApproval' as const, projectId: 'p1', at: 't4' }]
    const store = createInMemoryEventStore(events)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const state = await approveStoryboard(ctx, { projectId: 'p1' })
    expect(state.status).toBe('approved')
    expect(state.approved).toBe(true)
    expect(js.published.map((m) => m.subject)).toEqual(['vidgen.evt.p1.ApprovalGranted', 'vidgen.job.render.p1.-'])
  })
})
