import { describe, it, expect } from 'bun:test'
import { createInMemoryEventStore } from './testutil/inMemoryEventStore.js'
import type { Publisher } from './nats.js'
import type { Scene } from './events.js'
import { createCommandContext, createProject, type ScriptGenerator } from './commands.js'
import { generateScript } from './commands.js'
import { InvalidTransitionError, ProjectNotFoundError, ValidationError } from './aggregate.js'
import { resolveMaterial, generateVoiceovers, tuneProject, resolveMaterialWithAssets } from './commands.js'
import { CostCapExceededError } from './cost.js'
import { requestApproval, approveStoryboard } from './commands.js'
import { publish } from './commands.js'

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

describe('resolveMaterialWithAssets', () => {
  it('dispatches material jobs with localAssetPath when an uploaded path exists for that scene index', async () => {
    const store = createInMemoryEventStore(scriptedEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    const before = store.events.length
    await resolveMaterialWithAssets(ctx, { projectId: 'p1' }, ['/media/p1/assets/clip0.mp4', '/media/p1/assets/clip1.mp4'])
    expect(store.events).toHaveLength(before)
    expect(js.published.map((m) => m.subject)).toEqual(['vidgen.job.material.p1.0', 'vidgen.job.material.p1.1'])
    const job0 = JSON.parse(js.published[0]!.data) as Record<string, unknown>
    const job1 = JSON.parse(js.published[1]!.data) as Record<string, unknown>
    expect(job0.localAssetPath).toBe('/media/p1/assets/clip0.mp4')
    expect(job1.localAssetPath).toBe('/media/p1/assets/clip1.mp4')
  })

  it('dispatches material jobs without localAssetPath when no uploaded path exists for that scene index', async () => {
    const store = createInMemoryEventStore(scriptedEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    await resolveMaterialWithAssets(ctx, { projectId: 'p1' }, [])
    expect(js.published.map((m) => m.subject)).toEqual(['vidgen.job.material.p1.0', 'vidgen.job.material.p1.1'])
    const job0 = JSON.parse(js.published[0]!.data) as Record<string, unknown>
    const job1 = JSON.parse(js.published[1]!.data) as Record<string, unknown>
    expect('localAssetPath' in job0).toBe(false)
    expect('localAssetPath' in job1).toBe(false)
  })
})

describe('generateVoiceovers', () => {
  it('appends CostProjected then dispatches tts and caption jobs when under the cap', async () => {
    const store = createInMemoryEventStore(materialEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    const state = await generateVoiceovers(ctx, { projectId: 'p1' })
    expect(state.status).toBe('material') // CostProjected does not change status
    expect(store.events.at(-1)).toMatchObject({ type: 'CostProjected', capUsd: 0.15 })
    expect(js.published.map((m) => m.subject)).toEqual([
      'vidgen.evt.p1.CostProjected',
      'vidgen.job.tts.p1.0',
      'vidgen.job.tts.p1.1',
      'vidgen.job.caption.p1.-',
    ])
    // tts payload matches TTSJob worker contract
    const tts0 = JSON.parse(js.published[1]!.data) as Record<string, unknown>
    expect(tts0.text).toBe('scene zero narration')
    expect(tts0.voice).toBe('banmai') // default style voice
    expect(tts0.speed).toBe(0)        // default style speed
    expect(tts0.destPath).toBe('/media/p1/tts0.mp3')
    const tts1 = JSON.parse(js.published[2]!.data) as Record<string, unknown>
    expect(tts1.text).toBe('scene one narration')
    expect(tts1.destPath).toBe('/media/p1/tts1.mp3')
    // caption payload matches CaptionJob worker contract (single job, sceneIdx null)
    const caption = JSON.parse(js.published[3]!.data) as Record<string, unknown>
    expect(caption.sceneIdx).toBeNull()
    expect(caption.destPath).toBe('/media/p1/captions.ass')
    const sceneAudio = caption.sceneAudio as Array<Record<string, unknown>>
    expect(sceneAudio).toHaveLength(2)
    expect(sceneAudio[0]!.audioPath).toBe('/media/p1/tts0.mp3')
    expect(sceneAudio[1]!.audioPath).toBe('/media/p1/tts1.mp3')
    const style = caption.style as Record<string, unknown>
    expect(style.font_name).toBe('Arial')
    expect(style.font_size).toBe(64)
    expect(style.primary).toBe('#FFFFFF')
    expect(style.outline).toBe('#000000')
    expect(style.bold).toBe(true)
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
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    const state = await approveStoryboard(ctx, { projectId: 'p1' })
    expect(state.status).toBe('approved')
    expect(state.approved).toBe(true)
    expect(js.published.map((m) => m.subject)).toEqual(['vidgen.evt.p1.ApprovalGranted', 'vidgen.job.render.p1.-'])
    // render payload matches RenderJob worker contract
    const render = JSON.parse(js.published[1]!.data) as Record<string, unknown>
    expect(render.assPath).toBe('/media/p1/captions.ass')
    expect(render.outputPath).toBe('/media/p1/output.mp4')
    expect(render.music).toBeUndefined() // no music in default style
    const scenes = render.scenes as Array<Record<string, unknown>>
    expect(scenes).toHaveLength(2)
    expect(scenes[0]!.mediaPath).toBe('/media/p1/material0.mp4')
    expect(scenes[0]!.audioPath).toBe('/media/p1/tts0.mp3')
    expect(scenes[0]!.isImage).toBe(false)
    expect(scenes[1]!.mediaPath).toBe('/media/p1/material1.mp4')
    expect(scenes[1]!.audioPath).toBe('/media/p1/tts1.mp3')
  })

  it('includes music in render job when style.music is set', async () => {
    const events = [
      ...materialEvents,
      { v: 1 as const, type: 'StyleSet' as const, projectId: 'p1', at: 't3b', uid: 'u1',
        voice: 'banmai', speed: 0, captionStyle: { fontName: 'Arial', fontSize: 64 },
        music: { search: 'upbeat', volume: 0.4 } },
      { v: 1 as const, type: 'AwaitingApproval' as const, projectId: 'p1', at: 't4' },
    ]
    const store = createInMemoryEventStore(events)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    await approveStoryboard(ctx, { projectId: 'p1' })
    const render = JSON.parse(js.published[1]!.data) as Record<string, unknown>
    const music = render.music as Record<string, unknown>
    expect(music).toBeDefined()
    expect(music.search).toBe('upbeat')
    expect(music.volume).toBe(0.4)
    expect(music.path).toBe('')
  })
})

const preScriptedEvents = [
  { v: 1 as const, type: 'ProjectCreated' as const, projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
]

describe('tuneProject', () => {
  it('emits StyleSet with full style snapshot', async () => {
    const store = createInMemoryEventStore(preScriptedEvents)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    const state = await tuneProject(ctx, { projectId: 'p1', voice: 'lannhi', speed: 1 })
    const ev = store.events.at(-1)
    expect(ev?.type).toBe('StyleSet')
    if (ev?.type !== 'StyleSet') throw new Error()
    expect(ev.voice).toBe('lannhi')
    expect(ev.speed).toBe(1)
    expect(ev.captionStyle).toEqual({ fontName: 'Arial', fontSize: 64 })
    expect(ev.music).toBeNull()
    expect(state.style.voice).toBe('lannhi')
  })

  it('merges partial input over current style', async () => {
    const store = createInMemoryEventStore([
      ...preScriptedEvents,
      { v: 1 as const, type: 'StyleSet' as const, projectId: 'p1', at: 't1', uid: 'u0',
        voice: 'lannhi', speed: 2, captionStyle: { fontName: 'Arial', fontSize: 64 }, music: null },
    ])
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    const state = await tuneProject(ctx, { projectId: 'p1', speed: -1 })
    const ev = store.events.at(-1)
    if (ev?.type !== 'StyleSet') throw new Error()
    expect(ev.voice).toBe('lannhi')  // kept from previous
    expect(ev.speed).toBe(-1)        // updated
    expect(state.style.voice).toBe('lannhi')
  })

  it('explicit music null clears music', async () => {
    const store = createInMemoryEventStore([
      ...preScriptedEvents,
      { v: 1 as const, type: 'StyleSet' as const, projectId: 'p1', at: 't1', uid: 'u0',
        voice: 'banmai', speed: 0, captionStyle: { fontName: 'Arial', fontSize: 64 },
        music: { search: 'upbeat', volume: 0.5 } },
    ])
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15, '/media')
    await tuneProject(ctx, { projectId: 'p1', music: null })
    const ev = store.events.at(-1)
    if (ev?.type !== 'StyleSet') throw new Error()
    expect(ev.music).toBeNull()
  })

  it('rejects unknown voice', async () => {
    const store = createInMemoryEventStore(preScriptedEvents)
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15, '/media')
    await expect(tuneProject(ctx, { projectId: 'p1', voice: 'unknown' })).rejects.toThrow(ValidationError)
  })

  it('rejects speed out of range', async () => {
    const store = createInMemoryEventStore(preScriptedEvents)
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15, '/media')
    await expect(tuneProject(ctx, { projectId: 'p1', speed: 4 })).rejects.toThrow(ValidationError)
  })

  it('rejects music volume > 1', async () => {
    const store = createInMemoryEventStore(preScriptedEvents)
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15, '/media')
    await expect(tuneProject(ctx, { projectId: 'p1', music: { search: 'chill', volume: 1.5 } }))
      .rejects.toThrow(ValidationError)
  })

  it('rejects tuning an approved project', async () => {
    const store = createInMemoryEventStore([
      ...preScriptedEvents,
      { v: 1 as const, type: 'ScriptGenerated' as const, projectId: 'p1', at: 't1', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 },
      { v: 1 as const, type: 'MaterialResolved' as const, projectId: 'p1', at: 't2', sceneIdx: 0, source: 'pexels', assetPath: '/a' },
      { v: 1 as const, type: 'AwaitingApproval' as const, projectId: 'p1', at: 't3' },
      { v: 1 as const, type: 'ApprovalGranted' as const, projectId: 'p1', at: 't4' },
    ])
    const ctx = createCommandContext(store, fakePublisher(), fixedScriptGen, 0.15, '/media')
    await expect(tuneProject(ctx, { projectId: 'p1', speed: 1 })).rejects.toThrow(InvalidTransitionError)
  })
})

describe('publish', () => {
  it('appends Published from a rendered project', async () => {
    const events = [
      ...materialEvents,
      { v: 1 as const, type: 'AwaitingApproval' as const, projectId: 'p1', at: 't4' },
      { v: 1 as const, type: 'ApprovalGranted' as const, projectId: 'p1', at: 't5' },
      { v: 1 as const, type: 'RenderCompleted' as const, projectId: 'p1', at: 't6', outputPath: '/m/p1.mp4', renderUsd: 0 },
    ]
    const store = createInMemoryEventStore(events)
    const js = fakePublisher()
    const ctx = createCommandContext(store, js, fixedScriptGen, 0.15)
    const state = await publish(ctx, { projectId: 'p1', caption: 'hello', privacy: 'public' })
    expect(state.status).toBe('published')
    const appended = store.events.at(-1)
    expect(appended).toMatchObject({ type: 'Published', platform: 'public' })
  })
})
