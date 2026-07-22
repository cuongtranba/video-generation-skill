import type { ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
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

function ScriptDetail({ scenes, t }: { scenes: Scene[]; t: TFunction }): ReactNode {
  return (
    <div className="vg-step-detail__lines">
      {scenes.map((s) => (
        <div key={s.idx} className="vg-step-detail__line">
          <span className="vg-step-detail__line-idx">{sceneTag(s.idx)}</span>
          <div className="vg-step-detail__line-body">
            <span className="vg-step-detail__narration">{s.narration}</span>
            <span className="vg-step-detail__visual">
              {t('step.visualPrefix')} {s.visual}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function MaterialDetail({ projectId, scenes, t }: { projectId: string; scenes: Scene[]; t: TFunction }): ReactNode {
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
            <span className="vg-step-detail__clip-tag">{s.materialSource ?? t('step.searching')}</span>
            <span className="vg-step-detail__clip-visual">{s.visual}</span>
          </div>
        )
      })}
    </div>
  )
}

function VoiceDetail({ projectId, scenes, state, t }: { projectId: string; scenes: Scene[]; state: string; t: TFunction }): ReactNode {
  const total = scenes.reduce((a, s) => a + (s.audioDurationSec ?? 0), 0)
  const audios = scenes
    .map((s) => ({ idx: s.idx, url: mediaUrl(projectId, s.materialPath ? s.materialPath.replace(/material\d+\.\w+$/, `tts${s.idx}.mp3`) : undefined) }))
  const meta =
    state === 'done'
      ? scenes.map((s) => `${sceneTag(s.idx)} ${s.audioDurationSec ?? '—'}s`).join(' · ') + ` · ${t('step.voice.total', { total: total.toFixed(1) })}`
      : state === 'running'
        ? t('step.voice.synthesizing')
        : t('step.voice.queued')
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
        <span>{t('step.voiceLine')}</span>
        <span>{meta}</span>
      </div>
    </>
  )
}

function CaptionsDetail({ scenes, state, t }: { scenes: Scene[]; state: string; t: TFunction }): ReactNode {
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
      <span className="vg-step-detail__note">{t('step.captionsNote')}</span>
    </>
  )
}

function GateDetail({ projectId, scenes, t }: { projectId: string; scenes: Scene[]; t: TFunction }): ReactNode {
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
        {/* Key hints mirror pipeline/hotkeys.ts (A approve, R reject). The <kbd> is
            aria-hidden so the accessible name stays the translated label; the
            shortcut is exposed to AT via aria-keyshortcuts. */}
        <Button aria-keyshortcuts="A" onClick={() => void approveStoryboard({ projectId })}>
          {t('step.gate.approve')} <kbd className="vg-kbd" aria-hidden="true">A</kbd>
        </Button>
        <Button variant="secondary" aria-keyshortcuts="R" onClick={() => void generateScript({ projectId })}>
          {t('step.gate.reject')} <kbd className="vg-kbd" aria-hidden="true">R</kbd>
        </Button>
        <span className="vg-step-detail__note">{t('step.gate.frozenNote')}</span>
      </div>
    </>
  )
}

function RenderDetail({ projectId, project, state, t }: { projectId: string; project: ProjectState; state: string; t: TFunction }): ReactNode {
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
          <span className="vg-step-detail__output-name">{t('step.render.outputName')}</span>
          <span>{t('step.render.spec')}</span>
          <span>
            {t('step.render.totalCost')} ${project.spentUsd.toFixed(4)}
          </span>
        </div>
      </div>
    )
  }
  return (
    <>
      <div className="vg-step-detail__render-track">
        <div className="vg-step-detail__render-fill" />
      </div>
      <span className="vg-step-detail__note">{state === 'running' ? t('step.render.running') : t('step.render.queued')}</span>
    </>
  )
}

// Pending, next-in-line steps offer their run command so the board can drive
// the real pipeline (the design mock advances on timers; here we POST).
const RUNNABLE_STEPS = new Set<StepKey>(['script', 'material', 'voice'])

function subtitle(step: StepInfo, t: TFunction): string {
  const engine = step.engine
  switch (step.state) {
    case 'running':
      return t('step.sub.working', { engine })
    case 'done':
      return step.costUsd > 0 ? t('step.sub.doneCost', { engine, cost: step.costUsd.toFixed(4) }) : t('step.sub.done', { engine })
    case 'awaiting':
      return t('step.sub.awaiting')
    case 'failed':
      return t('step.sub.failed', { engine })
    default:
      return t('step.sub.queued', { engine })
  }
}

export function StepDetail({ projectId, step, project }: StepDetailProps) {
  const { t } = useTranslation()
  const events = useVidgenStore((state) => state.eventLog[projectId]) ?? []
  const resolveMaterial = useVidgenStore((state) => state.resolveMaterial)
  const generateScript = useVidgenStore((state) => state.generateScript)
  const generateVoiceovers = useVidgenStore((state) => state.generateVoiceovers)

  const title = step.key === 'gate' ? t('step.title.gate') : t(`step.label.${step.key}`)
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
        <div className="vg-step-detail__error">{fail?.error ?? t('step.error.fallback', { label: t(`step.label.${step.key}`) })}</div>
        <div className="vg-step-detail__actions">
          <Button aria-keyshortcuts="R" onClick={retry}>
            {t('step.error.retry')} <kbd className="vg-kbd" aria-hidden="true">R</kbd>
          </Button>
          <span className="vg-step-detail__note">{t('step.error.retryNote')}</span>
        </div>
      </>
    )
  } else if (step.key === 'script') {
    body = project.scenes.length > 0 ? <ScriptDetail scenes={project.scenes} t={t} /> : runPrompt('script')
  } else if (step.key === 'material') {
    body = project.scenes.some((s) => s.materialPath) ? <MaterialDetail projectId={projectId} scenes={project.scenes} t={t} /> : runPrompt('material')
  } else if (step.key === 'voice') {
    body = project.scenes.length > 0 ? <VoiceDetail projectId={projectId} scenes={project.scenes} state={step.state} t={t} /> : runPrompt('voice')
  } else if (step.key === 'captions') {
    body = <CaptionsDetail scenes={project.scenes} state={step.state} t={t} />
  } else if (step.key === 'gate') {
    body = step.state === 'awaiting' ? <GateDetail projectId={projectId} scenes={project.scenes} t={t} /> : <span className="vg-step-detail__note">{step.state === 'done' ? t('step.gate.approvedNote') : t('step.gate.waitsNote')}</span>
  } else {
    body = <RenderDetail projectId={projectId} project={project} state={step.state} t={t} />
  }

  function runPrompt(key: StepKey): ReactNode {
    if (!RUNNABLE_STEPS.has(key) || step.state !== 'pending') return null
    const fn = key === 'script' ? generateScript : key === 'material' ? resolveMaterial : generateVoiceovers
    return (
      <div className="vg-step-detail__actions">
        <Button onClick={() => void fn({ projectId })}>{t(`step.run.${key}`)}</Button>
        <span className="vg-step-detail__note">{t('step.run.note')}</span>
      </div>
    )
  }

  return (
    <div className={detailClass} data-testid="step-detail">
      <div className="vg-step-detail__head">
        <span className="vg-step-detail__title">{title}</span>
        <span className="vg-step-detail__sub">{subtitle(step, t)}</span>
      </div>
      {body}
    </div>
  )
}
