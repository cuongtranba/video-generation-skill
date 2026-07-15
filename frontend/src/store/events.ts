// Frozen event contract — copied verbatim from api/src/events.ts.
// Do NOT alter field shapes here. If the event union changes, update BOTH
// this file and api/src/events.ts in the same commit.

export type Scene = {
  idx: number
  narration: string
  visual: string
  // Runtime fields folded from worker result events (undefined until resolved).
  materialPath?: string
  materialSource?: string
  audioDurationSec?: number
}

export type StyleSpec = {
  voice: string
  speed: number
  captionStyle: { fontName: string; fontSize: number }
  music: { search: string; volume: number } | null
}

export const DEFAULT_STYLE: StyleSpec = {
  voice: 'banmai',
  speed: 0,
  captionStyle: { fontName: 'Arial', fontSize: 64 },
  music: null,
}

export type VidgenEvent =
  | { v: 1; type: 'ProjectCreated'; projectId: string; at: string; idea: string; durationSec: number; sceneCount: number; tone: string }
  | { v: 1; type: 'ScriptGenerated'; projectId: string; at: string; scenes: Scene[]; scriptUsd: number }
  | { v: 1; type: 'MaterialResolved'; projectId: string; at: string; sceneIdx: number; source: string; assetPath: string }
  | { v: 1; type: 'VoiceSynthesized'; projectId: string; at: string; sceneIdx: number; mp3Path: string; durationSec: number; ttsUsd: number }
  | { v: 1; type: 'CaptionsBuilt'; projectId: string; at: string; sceneIdx: number; assPath: string }
  | { v: 1; type: 'CostProjected'; projectId: string; at: string; projectedUsd: number; capUsd: number }
  | { v: 1; type: 'AwaitingApproval'; projectId: string; at: string }
  | { v: 1; type: 'ApprovalGranted'; projectId: string; at: string }
  | { v: 1; type: 'RenderCompleted'; projectId: string; at: string; outputPath: string; renderUsd: number }
  | { v: 1; type: 'Published'; projectId: string; at: string; platform: string; postId: string; url: string }
  | { v: 1; type: 'RunFailed'; projectId: string; at: string; stage: string; error: string }
  | { v: 1; type: 'StyleSet'; projectId: string; at: string; uid: string; voice: string; speed: number; captionStyle: { fontName: string; fontSize: number }; music: { search: string; volume: number } | null }

export type ProjectStatus = 'draft' | 'material' | 'scripted' | 'awaiting_approval' | 'approved' | 'rendered' | 'published' | 'failed'

export type ProjectState = {
  projectId: string
  status: ProjectStatus
  scenes: Scene[]
  spentUsd: number
  approved: boolean
  outputPath?: string
  style: StyleSpec
}

export function foldProject(events: VidgenEvent[]): ProjectState {
  const s: ProjectState = { projectId: '', status: 'draft', scenes: [], spentUsd: 0, approved: false, style: { ...DEFAULT_STYLE, captionStyle: { ...DEFAULT_STYLE.captionStyle } } }
  for (const e of events) {
    s.projectId = e.projectId
    switch (e.type) {
      case 'ProjectCreated': s.status = 'draft'; break
      case 'ScriptGenerated': s.scenes = e.scenes.map((sc) => ({ ...sc })); s.spentUsd += e.scriptUsd; s.status = 'scripted'; break
      case 'MaterialResolved': {
        const sc = s.scenes.find((x) => x.idx === e.sceneIdx)
        if (sc) { sc.materialPath = e.assetPath; sc.materialSource = e.source }
        s.status = 'material'
        break
      }
      case 'VoiceSynthesized': {
        s.spentUsd += e.ttsUsd
        const sc = s.scenes.find((x) => x.idx === e.sceneIdx)
        if (sc) { sc.audioDurationSec = e.durationSec }
        break
      }
      case 'CaptionsBuilt': break
      case 'AwaitingApproval': s.status = 'awaiting_approval'; break
      case 'ApprovalGranted': s.approved = true; s.status = 'approved'; break
      case 'RenderCompleted': s.spentUsd += e.renderUsd; s.outputPath = e.outputPath; s.status = 'rendered'; break
      case 'Published': s.status = 'published'; break
      case 'RunFailed': s.status = 'failed'; break
      case 'StyleSet':
        s.style = { voice: e.voice, speed: e.speed, captionStyle: { ...e.captionStyle }, music: e.music }
        break
    }
  }
  return s
}
