import { describe, it, expect } from 'bun:test'
import { foldProject, DEFAULT_STYLE, type VidgenEvent } from './events.js'

describe('foldProject', () => {
  it('folds a lifecycle into current state', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-09T00:00:00Z', idea: 'nước ấm', durationSec: 30, sceneCount: 3, tone: 'casual' },
      { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-09T00:01:00Z', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0.012 },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: '2026-07-09T00:02:00Z' },
      { v: 1, type: 'ApprovalGranted', projectId: 'p1', at: '2026-07-09T00:03:00Z' },
      { v: 1, type: 'RenderCompleted', projectId: 'p1', at: '2026-07-09T00:04:00Z', outputPath: '/m/p1.mp4', renderUsd: 0.004 },
    ]
    const s = foldProject(events)
    expect(s.status).toBe('rendered')
    expect(s.spentUsd).toBeCloseTo(0.016)
    expect(s.approved).toBe(true)
    expect(s.outputPath).toBe('/m/p1.mp4')
  })

  it('reports awaiting_approval before approval', () => {
    const s = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: 't' },
    ])
    expect(s.status).toBe('awaiting_approval')
    expect(s.approved).toBe(false)
  })

  it('leaves status/projectId at defaults for an empty log', () => {
    const s = foldProject([])
    expect(s.projectId).toBe('')
    expect(s.status).toBe('draft')
  })
})

describe('foldProject StyleSet', () => {
  it('returns default style when no StyleSet emitted', () => {
    const s = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
    ])
    expect(s.style).toEqual(DEFAULT_STYLE)
  })

  it('applies first StyleSet', () => {
    const s = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
      { v: 1, type: 'StyleSet', projectId: 'p1', at: 't1', uid: 'u1',
        voice: 'lannhi', speed: 1, captionStyle: { fontName: 'Arial', fontSize: 64 }, music: null },
    ])
    expect(s.style.voice).toBe('lannhi')
    expect(s.style.speed).toBe(1)
    expect(s.style.music).toBeNull()
  })

  it('last StyleSet wins (full snapshot)', () => {
    const s = foldProject([
      { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't0', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual' },
      { v: 1, type: 'StyleSet', projectId: 'p1', at: 't1', uid: 'u1',
        voice: 'lannhi', speed: 1, captionStyle: { fontName: 'Arial', fontSize: 64 }, music: null },
      { v: 1, type: 'StyleSet', projectId: 'p1', at: 't2', uid: 'u2',
        voice: 'banmai', speed: 0, captionStyle: { fontName: 'Times', fontSize: 48 },
        music: { search: 'upbeat', volume: 0.5 } },
    ])
    expect(s.style.voice).toBe('banmai')
    expect(s.style.captionStyle.fontName).toBe('Times')
    expect(s.style.music).toEqual({ search: 'upbeat', volume: 0.5 })
  })
})
