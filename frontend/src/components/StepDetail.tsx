import type { ReactNode } from 'react'
import { useVidgenStore } from '../store/store'
import { Button } from '../ui/Button'
import type { ProjectState, Scene } from '../store/events'
import { lastFailure, retryCommandFor, type StepInfo, type StepKey } from '../pipeline/derive'
import { mediaUrl } from '../pipeline/media'

interface StepDetailProps {
  projectId: string
  step: StepInfo
  project: ProjectState
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

function isImage(path: string): boolean {
  const lower = path.toLowerCase()
  return IMAGE_EXTS.some((ext) => lower.endsWith(ext))
}

function sceneTag(idx: number): string {
  return 'S' + String(idx).padStart(2, '0')
}

// Deterministic waveform geometry for the voice detail (no random / no state).
const DETAIL_WAVE = Array.from({ length: 36 }, (_, j) => 25 + Math.abs(Math.sin(j * 1.7)) * 65)

function ScriptDetail({ scenes }: { scenes: Scene[] }): ReactNode {
  return (
    <div className="vg-step-detail__lines">
      {scenes.map((s) => (
        <div key={s.idx} className="vg-step-detail__line">
          <span className="vg-step-detail__line-idx">{sceneTag(s.idx)}</span>
          <div className="vg-step-detail__line-body">
            <span className="vg-step-detail__narration">{s.narration}</span>
            <span className="vg-step-detail__visual">visual: {s.visual}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function MaterialDetail({ projectId, scenes }: { projectId: string; scenes: Scene[] }): ReactNode {
  return (
    <div className="vg-step-detail__clips">
      {scenes.map((s) => {
        const url = mediaUrl(projectId, s.materialPath)
        return (
          <div key={s.idx} className="vg-step-detail__clip">
            {url &&
              (isImage(url) ? (
                <img className="vg-step-detail__clip-media" src={url} alt={s.visual} />
              ) : (
                <video className="vg-step-detail__clip-media" src={url} muted loop playsInline controls />
              ))}
            <span className="vg-step-detail__clip-tag">{s.materialSource ?? 'searching…'}</span>
            <span className="vg-step-detail__clip-visual">{s.visual}</span>
          </div>
        )
      })}
    </div>
  )
}

function VoiceDetail({ projectId, scenes, state }: { projectId: string; scenes: Scene[]; state: string }): ReactNode {
  const total = scenes.reduce((a, s) => a + (s.audioDurationSec ?? 0), 0)
  const audios = scenes
    .map((s) => ({ idx: s.idx, url: mediaUrl(projectId, s.materialPath ? s.materialPath.replace(/material\d+\.\w+$/, `tts${s.idx}.mp3`) : undefined) }))
  const meta =
    state === 'done'
      ? scenes.map((s) => `${sceneTag(s.idx)} ${s.audioDurationSec ?? '—'}s`).join(' · ') + ` · ${total.toFixed(1)}s total`
      : state === 'running'
        ? 'synthesizing…'
        : 'queued'
  return (
    <>
      <div className="vg-step-detail__wave">
        {DETAIL_WAVE.map((h, j) => (
          <div key={j} className="vg-step-detail__wavebar" style={{ height: `${h.toFixed(0)}%`, animationDelay: `${(j % 6) * 0.09}s` }} />
        ))}
      </div>
      {state === 'done' && audios.some((a) => a.url) && (
        <div className="vg-step-detail__audios">
          {audios.map((a) => a.url && <audio key={a.idx} src={a.url} controls preload="none" />)}
        </div>
      )}
      <div className="vg-step-detail__meta">
        <span>voice: banmai</span>
        <span>{meta}</span>
      </div>
    </>
  )
}

function CaptionsDetail({ scenes, state }: { scenes: Scene[]; state: string }): ReactNode {
  const words = (scenes[0]?.narration ?? '').split(' ').filter(Boolean)
  const animate = state === 'running' || state === 'done'
  return (
    <>
      <div className="vg-step-detail__karaoke" style={{ ['--vg-karaoke-dur' as string]: `${words.length * 0.4}s` }}>
        {words.map((word, j) => (
          <span
            key={j}
            className="vg-step-detail__karaoke-word"
            style={animate ? { animationDelay: `${j * 0.4}s` } : undefined}
          >
            {word}
          </span>
        ))}
      </div>
      <span className="vg-step-detail__note">karaoke · Arial 64 · word-level timestamps from whisper</span>
    </>
  )
}

function GateDetail({ projectId, scenes }: { projectId: string; scenes: Scene[] }): ReactNode {
  const approveStoryboard = useVidgenStore((state) => state.approveStoryboard)
  const generateScript = useVidgenStore((state) => state.generateScript)
  return (
    <>
      <div className="vg-step-detail__scenes">
        {scenes.map((s) => (
          <div key={s.idx} className="vg-step-detail__scene">
            <span className="vg-step-detail__scene-meta">
              {sceneTag(s.idx)} · {s.materialSource ?? '—'} · {s.audioDurationSec ?? '—'}s
            </span>
            <span className="vg-step-detail__scene-narration">{s.narration}</span>
          </div>
        ))}
      </div>
      <div className="vg-step-detail__actions">
        <Button onClick={() => void approveStoryboard({ projectId })}>Approve storyboard</Button>
        <Button variant="secondary" onClick={() => void generateScript({ projectId })}>
          Reject &amp; rescript
        </Button>
        <span className="vg-step-detail__note">Voice, captions, and music are frozen once approved.</span>
      </div>
    </>
  )
}

function RenderDetail({ projectId, project, state }: { projectId: string; project: ProjectState; state: string }): ReactNode {
  if (state === 'done') {
    const url = mediaUrl(projectId, project.outputPath)
    return (
      <div className="vg-step-detail__output">
        {url ? (
          <video className="vg-step-detail__player" src={url} controls playsInline />
        ) : (
          <div className="vg-step-detail__player" />
        )}
        <div className="vg-step-detail__output-meta">
          <span className="vg-step-detail__output-name">output.mp4</span>
          <span>1080×1920 · h264</span>
          <span>total cost ${project.spentUsd.toFixed(4)}</span>
        </div>
      </div>
    )
  }
  return (
    <>
      <div className="vg-step-detail__render-track">
        <div className="vg-step-detail__render-fill" />
      </div>
      <span className="vg-step-detail__note">
        {state === 'running' ? 'concat + captions + music duck' : 'queued · 1080×1920 h264'}
      </span>
    </>
  )
}

// Pending, next-in-line steps offer their run command so the board can drive
// the real pipeline (the design mock advances on timers; here we POST).
const RUN_LABEL: Partial<Record<StepKey, string>> = {
  script: 'Generate script',
  material: 'Resolve material',
  voice: 'Generate voiceovers',
}

function subtitle(step: StepInfo): string {
  const engine = step.engine
  switch (step.state) {
    case 'running':
      return `${engine} · working…`
    case 'done':
      return step.costUsd > 0 ? `${engine} · $${step.costUsd.toFixed(4)}` : `${engine} · complete`
    case 'awaiting':
      return 'blocking · human decision'
    case 'failed':
      return `${engine} · failed`
    default:
      return `${engine} · queued`
  }
}

export function StepDetail({ projectId, step, project }: StepDetailProps) {
  const events = useVidgenStore((state) => state.eventLog[projectId]) ?? []
  const resolveMaterial = useVidgenStore((state) => state.resolveMaterial)
  const generateScript = useVidgenStore((state) => state.generateScript)
  const generateVoiceovers = useVidgenStore((state) => state.generateVoiceovers)

  const title = step.key === 'gate' ? 'approval gate' : step.label
  const detailClass = ['vg-step-detail', step.state === 'running' ? 'vg-step-detail--running' : '', step.state === 'done' ? 'vg-step-detail--done' : '']
    .filter(Boolean)
    .join(' ')

  let body: ReactNode = null
  if (step.state === 'failed') {
    const fail = lastFailure(events)
    const retryCmd = fail ? retryCommandFor(fail.stage) : undefined
    const retry = () => {
      if (retryCmd === 'GenerateScript') void generateScript({ projectId })
      else if (retryCmd === 'ResolveMaterial') void resolveMaterial({ projectId })
      else if (retryCmd === 'GenerateVoiceovers') void generateVoiceovers({ projectId })
    }
    body = (
      <>
        <div className="vg-step-detail__error">{fail?.error ?? `${step.label} failed`}</div>
        <div className="vg-step-detail__actions">
          <Button onClick={retry}>Retry step</Button>
          <span className="vg-step-detail__note">Retries only this step. Upstream artifacts are kept.</span>
        </div>
      </>
    )
  } else if (step.key === 'script') {
    body = project.scenes.length > 0 ? <ScriptDetail scenes={project.scenes} /> : runPrompt('script')
  } else if (step.key === 'material') {
    body = project.scenes.some((s) => s.materialPath) ? <MaterialDetail projectId={projectId} scenes={project.scenes} /> : runPrompt('material')
  } else if (step.key === 'voice') {
    body = project.scenes.length > 0 ? <VoiceDetail projectId={projectId} scenes={project.scenes} state={step.state} /> : runPrompt('voice')
  } else if (step.key === 'captions') {
    body = <CaptionsDetail scenes={project.scenes} state={step.state} />
  } else if (step.key === 'gate') {
    body = step.state === 'awaiting' ? <GateDetail projectId={projectId} scenes={project.scenes} /> : <span className="vg-step-detail__note">{step.state === 'done' ? 'approved · spec frozen' : 'waits for captions'}</span>
  } else {
    body = <RenderDetail projectId={projectId} project={project} state={step.state} />
  }

  function runPrompt(key: StepKey): ReactNode {
    const label = RUN_LABEL[key]
    if (!label || step.state !== 'pending') return null
    const fn = key === 'script' ? generateScript : key === 'material' ? resolveMaterial : generateVoiceovers
    return (
      <div className="vg-step-detail__actions">
        <Button onClick={() => void fn({ projectId })}>{label}</Button>
        <span className="vg-step-detail__note">Next step in the pipeline.</span>
      </div>
    )
  }

  return (
    <div className={detailClass} data-testid="step-detail">
      <div className="vg-step-detail__head">
        <span className="vg-step-detail__title">{title}</span>
        <span className="vg-step-detail__sub">{subtitle(step)}</span>
      </div>
      {body}
    </div>
  )
}
