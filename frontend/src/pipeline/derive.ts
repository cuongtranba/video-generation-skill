// Pure derivation of the Pipeline Home board model from folded ProjectState +
// the raw event log. No React, no store — table-tested in derive.test.ts.
import type { ProjectState, VidgenEvent } from '../store/events'

export type StepKey = 'script' | 'material' | 'voice' | 'captions' | 'gate' | 'render'
export type StepState = 'pending' | 'running' | 'done' | 'awaiting' | 'failed'

export interface StepInfo {
  key: StepKey
  label: string
  engine: string
  state: StepState
  costUsd: number
}

/** Client-side "command dispatched, result event not seen yet" flags. */
export type InFlight = Partial<Record<StepKey, boolean>>

const STEP_META: ReadonlyArray<{ key: StepKey; label: string; engine: string }> = [
  { key: 'script', label: 'script', engine: 'claude sdk' },
  { key: 'material', label: 'material', engine: 'pexels·local' },
  { key: 'voice', label: 'voiceover', engine: 'elevenlabs' },
  { key: 'captions', label: 'captions', engine: 'whisper' },
  { key: 'gate', label: 'approval', engine: 'human gate' },
  { key: 'render', label: 'render', engine: 'ffmpeg' },
]

/** RunFailed.stage values (worker + api) → board step. */
const STAGE_TO_STEP: Record<string, StepKey> = {
  script: 'script',
  material: 'material',
  tts: 'voice',
  caption: 'captions',
  render: 'render',
}

/** Result event that marks a step's failure as superseded. */
const SUCCESS_EVENT_TO_STEP: Partial<Record<VidgenEvent['type'], StepKey>> = {
  ScriptGenerated: 'script',
  MaterialResolved: 'material',
  VoiceSynthesized: 'voice',
  CaptionsBuilt: 'captions',
  ApprovalGranted: 'gate',
  RenderCompleted: 'render',
}

/** Which step's in-flight flag a result event settles (success or failure). */
export function stepClearedBy(e: VidgenEvent): StepKey | undefined {
  if (e.type === 'RunFailed') return STAGE_TO_STEP[e.stage]
  return SUCCESS_EVENT_TO_STEP[e.type]
}

export type RetryCommand = 'GenerateScript' | 'ResolveMaterial' | 'GenerateVoiceovers' | 'ApproveStoryboard'

const STAGE_TO_RETRY: Record<string, RetryCommand> = {
  script: 'GenerateScript',
  material: 'ResolveMaterial',
  tts: 'GenerateVoiceovers',
  caption: 'GenerateVoiceovers',
  render: 'ApproveStoryboard',
}

export function retryCommandFor(stage: string): RetryCommand | undefined {
  return STAGE_TO_RETRY[stage]
}

interface Failure {
  stage: string
  error: string
}

/** Walk the log and keep, per step, the last failure not superseded by a later success event. */
function unsupersededFailures(events: VidgenEvent[]): Partial<Record<StepKey, Failure>> {
  const failures: Partial<Record<StepKey, Failure>> = {}
  for (const e of events) {
    if (e.type === 'RunFailed') {
      const step = STAGE_TO_STEP[e.stage]
      if (step) failures[step] = { stage: e.stage, error: e.error }
      continue
    }
    const cleared = SUCCESS_EVENT_TO_STEP[e.type]
    if (cleared) delete failures[cleared]
  }
  return failures
}

/** The most recent failure across all steps, if none of its steps succeeded later. */
export function lastFailure(events: VidgenEvent[]): Failure | undefined {
  const failures = unsupersededFailures(events)
  // Order in the log is chronological; recompute by walking backwards.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'RunFailed') continue
    const step = STAGE_TO_STEP[e.stage]
    if (step && failures[step]?.error === e.error) return failures[step]
  }
  return undefined
}

/** Per-video cost cap; api default is $0.15 unless a CostProjected event says otherwise. */
export function capUsd(events: VidgenEvent[]): number {
  let cap = 0.15
  for (const e of events) {
    if (e.type === 'CostProjected') cap = e.capUsd
  }
  return cap
}

export function deriveSteps(project: ProjectState, events: VidgenEvent[], inFlight: InFlight): StepInfo[] {
  const failures = unsupersededFailures(events)
  const scenes = project.scenes

  const scriptDone = scenes.length > 0
  const materialResolved = scenes.filter((s) => s.materialPath !== undefined).length
  const materialDone = scriptDone && materialResolved === scenes.length
  const voiced = scenes.filter((s) => s.audioDurationSec !== undefined).length
  const voiceDone = scriptDone && voiced === scenes.length
  const captionsDone = project.captionsReady
  const renderDone = project.outputPath !== undefined

  const costs: Record<StepKey, number> = { script: 0, material: 0, voice: 0, captions: 0, gate: 0, render: 0 }
  for (const e of events) {
    if (e.type === 'ScriptGenerated') costs.script += e.scriptUsd
    else if (e.type === 'VoiceSynthesized') costs.voice += e.ttsUsd
    else if (e.type === 'RenderCompleted') costs.render += e.renderUsd
  }

  function stateOf(key: StepKey): StepState {
    const done =
      key === 'script' ? scriptDone
      : key === 'material' ? materialDone
      : key === 'voice' ? voiceDone
      : key === 'captions' ? captionsDone
      : key === 'gate' ? project.approved
      : renderDone
    if (done) return 'done'
    if (inFlight[key]) return 'running'
    if (failures[key]) return 'failed'
    switch (key) {
      case 'material':
        return materialResolved > 0 ? 'running' : 'pending'
      case 'voice':
        return voiced > 0 ? 'running' : 'pending'
      case 'captions':
        // The caption job is dispatched with the voiceovers and lags behind
        // whisper transcription (~2-3 min), so voice-done implies captions run.
        return voiceDone ? 'running' : 'pending'
      case 'gate':
        return project.status === 'awaiting_approval' ? 'awaiting' : 'pending'
      case 'render':
        return project.approved ? 'running' : 'pending'
      default:
        return 'pending'
    }
  }

  return STEP_META.map((m) => ({ ...m, state: stateOf(m.key), costUsd: costs[m.key] }))
}

/** Default node selection: the step that needs eyes, else the next actionable one. */
export function activeStep(steps: StepInfo[]): StepKey {
  const hot = steps.find((s) => s.state === 'running' || s.state === 'awaiting' || s.state === 'failed')
  if (hot) return hot.key
  const pending = steps.find((s) => s.state === 'pending')
  if (pending) return pending.key
  return 'render'
}
