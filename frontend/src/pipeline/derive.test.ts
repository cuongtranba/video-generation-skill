import { describe, expect, it } from 'bun:test'
import type { ProjectState, Scene, VidgenEvent } from '../store/events'
import { DEFAULT_STYLE } from '../store/events'
import {
  activeStep,
  capUsd,
  deriveSteps,
  lastFailure,
  retryCommandFor,
  type InFlight,
  type StepKey,
  type StepState,
} from './derive'

const AT = '2026-07-22T08:15:30.000Z'

function project(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    projectId: 'p1',
    status: 'draft',
    scenes: [],
    spentUsd: 0,
    approved: false,
    style: { ...DEFAULT_STYLE, captionStyle: { ...DEFAULT_STYLE.captionStyle } },
    captionsReady: false,
    language: 'Vietnamese',
    ...overrides,
  }
}

function scene(idx: number, overrides: Partial<Scene> = {}): Scene {
  return { idx, narration: `narration ${idx}`, visual: `visual ${idx}`, ...overrides }
}

function failed(stage: string, error = 'boom'): VidgenEvent {
  return { v: 1, type: 'RunFailed', projectId: 'p1', at: AT, stage, error }
}

function statesOf(p: ProjectState, events: VidgenEvent[] = [], inFlight: InFlight = {}): Record<StepKey, StepState> {
  const out = {} as Record<StepKey, StepState>
  for (const s of deriveSteps(p, events, inFlight)) out[s.key] = s.state
  return out
}

describe('deriveSteps', () => {
  it('returns the six pipeline steps in order with labels and engines', () => {
    const steps = deriveSteps(project(), [], {})
    expect(steps.map((s) => s.key)).toEqual(['script', 'material', 'voice', 'captions', 'gate', 'render'])
    expect(steps.map((s) => s.label)).toEqual(['script', 'material', 'voiceover', 'captions', 'approval', 'render'])
    expect(steps.map((s) => s.engine)).toEqual(['claude sdk', 'pexels·local', 'elevenlabs', 'whisper', 'human gate', 'ffmpeg'])
  })

  const cases: Array<{
    name: string
    project: ProjectState
    events?: VidgenEvent[]
    inFlight?: InFlight
    want: Partial<Record<StepKey, StepState>>
  }> = [
    {
      name: 'fresh draft: everything pending',
      project: project(),
      want: { script: 'pending', material: 'pending', voice: 'pending', captions: 'pending', gate: 'pending', render: 'pending' },
    },
    {
      name: 'script in flight: script running',
      project: project(),
      inFlight: { script: true },
      want: { script: 'running' },
    },
    {
      name: 'scripted: script done',
      project: project({ status: 'scripted', scenes: [scene(0), scene(1)] }),
      want: { script: 'done', material: 'pending' },
    },
    {
      name: 'partial material resolution counts as running',
      project: project({ status: 'material', scenes: [scene(0, { materialPath: '/media/p1/m0.mp4' }), scene(1)] }),
      want: { material: 'running' },
    },
    {
      name: 'all material resolved: done',
      project: project({
        status: 'material',
        scenes: [scene(0, { materialPath: '/media/p1/m0.mp4' }), scene(1, { materialPath: '/media/p1/m1.jpg' })],
      }),
      want: { material: 'done', voice: 'pending' },
    },
    {
      name: 'partial voiceovers count as running',
      project: project({
        status: 'material',
        scenes: [scene(0, { materialPath: 'a', audioDurationSec: 6.4 }), scene(1, { materialPath: 'b' })],
      }),
      want: { voice: 'running' },
    },
    {
      name: 'voice done, captions not ready: captions derived running (whisper lag)',
      project: project({
        status: 'material',
        scenes: [scene(0, { materialPath: 'a', audioDurationSec: 6.4 }), scene(1, { materialPath: 'b', audioDurationSec: 7.1 })],
      }),
      want: { voice: 'done', captions: 'running' },
    },
    {
      name: 'awaiting approval: gate awaiting',
      project: project({ status: 'awaiting_approval', scenes: [scene(0, { materialPath: 'a', audioDurationSec: 1 })], captionsReady: true }),
      want: { captions: 'done', gate: 'awaiting', render: 'pending' },
    },
    {
      name: 'approved: gate done, render running',
      project: project({ status: 'approved', approved: true, scenes: [scene(0, { materialPath: 'a', audioDurationSec: 1 })], captionsReady: true }),
      want: { gate: 'done', render: 'running' },
    },
    {
      name: 'rendered: render done',
      project: project({ status: 'rendered', approved: true, outputPath: '/media/p1/output.mp4', scenes: [scene(0, { materialPath: 'a', audioDurationSec: 1 })], captionsReady: true }),
      want: { render: 'done' },
    },
    {
      name: 'material failure marks the material step failed',
      project: project({ status: 'failed', scenes: [scene(0), scene(1)] }),
      events: [failed('material', 'pexels: 429 rate limited')],
      want: { script: 'done', material: 'failed', voice: 'pending' },
    },
    {
      name: 'tts failure maps to the voice step',
      project: project({ status: 'failed', scenes: [scene(0, { materialPath: 'a' })] }),
      events: [failed('tts')],
      want: { voice: 'failed' },
    },
    {
      name: 'render failure beats derived render-running',
      project: project({ status: 'failed', approved: true, scenes: [scene(0, { materialPath: 'a', audioDurationSec: 1 })], captionsReady: true }),
      events: [failed('render', 'ffmpeg exit 1')],
      want: { gate: 'done', render: 'failed' },
    },
    {
      name: 'retry in flight beats failed',
      project: project({ status: 'failed', scenes: [scene(0)] }),
      events: [failed('material')],
      inFlight: { material: true },
      want: { material: 'running' },
    },
    {
      name: 'a later success supersedes an earlier failure',
      project: project({
        status: 'material',
        scenes: [scene(0, { materialPath: '/media/p1/m0.mp4' })],
      }),
      events: [
        failed('material'),
        { v: 1, type: 'MaterialResolved', projectId: 'p1', at: AT, sceneIdx: 0, source: 'pexels', assetPath: '/media/p1/m0.mp4' },
      ],
      want: { material: 'done' },
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const got = statesOf(c.project, c.events ?? [], c.inFlight ?? {})
      for (const [key, want] of Object.entries(c.want)) {
        expect(`${key}=${got[key as StepKey]}`).toBe(`${key}=${want}`)
      }
    })
  }

  it('accumulates per-step cost from events', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: AT, scenes: [scene(0)], scriptUsd: 0.001 },
      { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: AT, sceneIdx: 0, mp3Path: '/media/p1/v0.mp3', durationSec: 6.4, ttsUsd: 0.0013 },
      { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: AT, sceneIdx: 1, mp3Path: '/media/p1/v1.mp3', durationSec: 7.1, ttsUsd: 0.0013 },
      { v: 1, type: 'RenderCompleted', projectId: 'p1', at: AT, outputPath: '/media/p1/output.mp4', renderUsd: 0 },
    ]
    const steps = deriveSteps(project({ scenes: [scene(0)] }), events, {})
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s.costUsd]))
    expect(byKey.script).toBeCloseTo(0.001)
    expect(byKey.voice).toBeCloseTo(0.0026)
    expect(byKey.render).toBe(0)
    expect(byKey.gate).toBe(0)
  })
})

describe('activeStep', () => {
  it('picks the first running/awaiting/failed step', () => {
    const p = project({ status: 'awaiting_approval', scenes: [scene(0, { materialPath: 'a', audioDurationSec: 1 })], captionsReady: true })
    expect(activeStep(deriveSteps(p, [], {}))).toBe('gate')
  })

  it('falls back to the first pending step (next actionable)', () => {
    const p = project({ status: 'scripted', scenes: [scene(0)] })
    expect(activeStep(deriveSteps(p, [], {}))).toBe('material')
  })

  it('is render when everything is done', () => {
    const p = project({ status: 'rendered', approved: true, outputPath: '/media/p1/output.mp4', scenes: [scene(0, { materialPath: 'a', audioDurationSec: 1 })], captionsReady: true })
    expect(activeStep(deriveSteps(p, [], {}))).toBe('render')
  })
})

describe('lastFailure', () => {
  it('returns the last un-superseded failure', () => {
    const events: VidgenEvent[] = [
      failed('material', 'first'),
      { v: 1, type: 'MaterialResolved', projectId: 'p1', at: AT, sceneIdx: 0, source: 'pexels', assetPath: 'a' },
      failed('tts', 'tts timeout'),
    ]
    expect(lastFailure(events)).toEqual({ stage: 'tts', error: 'tts timeout' })
  })

  it('is undefined when a success supersedes the failure', () => {
    const events: VidgenEvent[] = [
      failed('material', 'first'),
      { v: 1, type: 'MaterialResolved', projectId: 'p1', at: AT, sceneIdx: 0, source: 'pexels', assetPath: 'a' },
    ]
    expect(lastFailure(events)).toBeUndefined()
  })
})

describe('retryCommandFor', () => {
  it.each([
    ['script', 'GenerateScript'],
    ['material', 'ResolveMaterial'],
    ['tts', 'GenerateVoiceovers'],
    ['caption', 'GenerateVoiceovers'],
    ['render', 'ApproveStoryboard'],
  ] as const)('%s → %s', (stage, want) => {
    expect(retryCommandFor(stage)).toBe(want)
  })

  it('is undefined for unknown stages', () => {
    expect(retryCommandFor('unknown')).toBeUndefined()
  })
})

describe('capUsd', () => {
  it('defaults to 0.15', () => {
    expect(capUsd([])).toBe(0.15)
  })

  it('reads the last CostProjected cap', () => {
    const events: VidgenEvent[] = [
      { v: 1, type: 'CostProjected', projectId: 'p1', at: AT, projectedUsd: 0.01, capUsd: 0.25 },
    ]
    expect(capUsd(events)).toBe(0.25)
  })
})
