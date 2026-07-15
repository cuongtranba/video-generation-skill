import { describe, expect, it } from 'bun:test'
import { foldProject, type VidgenEvent } from './events'

const at = '2026-01-01T00:00:00Z'

describe('foldProject', () => {
  it('starts a project in draft on ProjectCreated', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 3, tone: 'fun', language: 'English' },
    ]
    const state = foldProject(events)
    expect(state).toMatchObject({ projectId: 'p1', status: 'draft', spentUsd: 0, approved: false })
  })

  it('adds scenes and scriptUsd on ScriptGenerated, moves to scripted', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun', language: 'English' },
      { v: 1, type: 'ScriptGenerated', projectId: 'p1', at, scenes: [{ idx: 0, narration: 'n', visual: 'v' }], scriptUsd: 0 },
    ]
    const state = foldProject(events)
    expect(state.status).toBe('scripted')
    expect(state.scenes).toEqual([{ idx: 0, narration: 'n', visual: 'v' }])
    expect(state.spentUsd).toBe(0)
  })

  it('moves to material on MaterialResolved', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun', language: 'English' },
      { v: 1, type: 'MaterialResolved', projectId: 'p1', at, sceneIdx: 0, source: 'pexels', assetPath: '/m/0.mp4' },
    ]
    expect(foldProject(events).status).toBe('material')
  })

  it('accumulates ttsUsd across VoiceSynthesized events', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 2, tone: 'fun', language: 'English' },
      { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at, sceneIdx: 0, mp3Path: 'a.mp3', durationSec: 2.0, ttsUsd: 0.02 },
      { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at, sceneIdx: 1, mp3Path: 'b.mp3', durationSec: 3.0, ttsUsd: 0.03 },
    ]
    expect(foldProject(events).spentUsd).toBeCloseTo(0.05)
  })

  it('moves to awaiting_approval on AwaitingApproval', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun', language: 'English' },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at },
    ]
    expect(foldProject(events).status).toBe('awaiting_approval')
  })

  it('sets approved=true and status approved on ApprovalGranted', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun', language: 'English' },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at },
      { v: 1, type: 'ApprovalGranted', projectId: 'p1', at },
    ]
    const state = foldProject(events)
    expect(state.approved).toBe(true)
    expect(state.status).toBe('approved')
  })

  it('records outputPath and renderUsd on RenderCompleted', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun', language: 'English' },
      { v: 1, type: 'RenderCompleted', projectId: 'p1', at, outputPath: '/out/p1.mp4', renderUsd: 0 },
    ]
    const state = foldProject(events)
    expect(state.status).toBe('rendered')
    expect(state.outputPath).toBe('/out/p1.mp4')
  })

  it('moves to published on Published, and failed on RunFailed', () => {
    const published = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun', language: 'English' },
      { v: 1, type: 'Published', projectId: 'p1', at, platform: 'tiktok', postId: 'x', url: 'https://x' },
    ])
    expect(published.status).toBe('published')

    const failed = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at, idea: 'cats', durationSec: 30, sceneCount: 1, tone: 'fun', language: 'English' },
      { v: 1, type: 'RunFailed', projectId: 'p1', at, stage: 'tts', error: 'boom' },
    ])
    expect(failed.status).toBe('failed')
  })
})
