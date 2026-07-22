// Maps frozen VidgenEvents to the Pipeline Home event-log rows
// (dotted lowercase type token + terse mono message + tone).
import type { VidgenEvent } from './../store/events'

export type EventTone = 'neutral' | 'good' | 'warn' | 'bad'

export interface EventRow {
  time: string
  type: string
  msg: string
  tone: EventTone
}

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}

function sceneTag(idx: number): string {
  return 'S' + String(idx).padStart(2, '0')
}

export function formatEvent(e: VidgenEvent): EventRow {
  const time = new Date(e.at).toTimeString().slice(0, 8)
  switch (e.type) {
    case 'ProjectCreated':
      return { time, type: 'project.created', msg: `idea accepted · ${e.sceneCount} scenes · ${e.durationSec}s`, tone: 'neutral' }
    case 'ScriptGenerated':
      return { time, type: 'script.done', msg: `${e.scenes.length} scenes · $${e.scriptUsd.toFixed(4)}`, tone: 'neutral' }
    case 'MaterialResolved':
      return { time, type: 'material.done', msg: `${sceneTag(e.sceneIdx)} · ${e.source} · ${basename(e.assetPath)}`, tone: 'neutral' }
    case 'VoiceSynthesized':
      return { time, type: 'tts.done', msg: `${sceneTag(e.sceneIdx)} · ${e.durationSec}s audio · $${e.ttsUsd.toFixed(4)}`, tone: 'neutral' }
    case 'CaptionsBuilt':
      return { time, type: 'captions.done', msg: `${sceneTag(e.sceneIdx)} · ${basename(e.assPath)}`, tone: 'neutral' }
    case 'CostProjected':
      return { time, type: 'cost.projected', msg: `$${e.projectedUsd.toFixed(4)} of $${e.capUsd} cap`, tone: 'neutral' }
    case 'AwaitingApproval':
      return { time, type: 'gate.waiting', msg: 'storyboard ready for review', tone: 'warn' }
    case 'ApprovalGranted':
      return { time, type: 'gate.approved', msg: 'storyboard approved · spec frozen', tone: 'good' }
    case 'RenderCompleted':
      return { time, type: 'render.done', msg: basename(e.outputPath), tone: 'good' }
    case 'Published':
      return { time, type: 'published', msg: `${e.platform} · ${e.url}`, tone: 'good' }
    case 'RunFailed':
      return { time, type: `${e.stage}.failed`, msg: e.error, tone: 'bad' }
    case 'StyleSet':
      return { time, type: 'style.set', msg: `voice ${e.voice} · ${e.captionStyle.fontName} ${e.captionStyle.fontSize}`, tone: 'neutral' }
  }
}
