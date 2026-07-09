import { describe, it, expect } from 'bun:test'
import { createInMemoryEventStore } from './testutil/inMemoryEventStore.js'
import type { Publisher } from './nats.js'
import type { Scene } from './events.js'
import { createCommandContext, createProject, type ScriptGenerator } from './commands.js'

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
