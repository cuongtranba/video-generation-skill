import { describe, it, expect } from 'bun:test'
import { createInMemoryEventStore } from './testutil/inMemoryEventStore.js'
import type { Publisher } from './nats.js'
import type { Scene } from './events.js'
import { createCommandContext, createProject, type ScriptGenerator } from './commands.js'
import { generateScript } from './commands.js'
import { InvalidTransitionError, ProjectNotFoundError } from './aggregate.js'

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
