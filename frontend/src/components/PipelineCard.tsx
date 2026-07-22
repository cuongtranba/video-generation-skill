import { Fragment, type KeyboardEvent, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useVidgenStore } from '../store/store'
import { CostBadge } from './CostBadge'
import { EventLog } from './EventLog'
import { PipelineNode } from './PipelineNode'
import { StepDetail } from './StepDetail'
import { activeStep, capUsd, deriveSteps, lastFailure, retryCommandFor, type StepInfo } from '../pipeline/derive'
import { hotkeyFor } from '../pipeline/hotkeys'

interface PipelineCardProps {
  projectId: string
}

function edgeClass(steps: StepInfo[], i: number): string {
  const cur = steps[i]
  const next = steps[i + 1]
  const flowing = cur.state === 'done' && (next.state === 'running' || next.state === 'awaiting')
  if (flowing) return 'vg-node-edge vg-node-edge--flowing'
  if (cur.state === 'done' && next.state !== 'pending') return 'vg-node-edge vg-node-edge--solid'
  if (cur.state === 'done') return 'vg-node-edge vg-node-edge--done'
  return 'vg-node-edge'
}

export function PipelineCard({ projectId }: PipelineCardProps) {
  const { t } = useTranslation()
  const project = useVidgenStore((state) => state.projects[projectId])
  const events = useVidgenStore((state) => state.eventLog[projectId]) ?? []
  const inFlight = useVidgenStore((state) => state.inFlight[projectId]) ?? {}
  const selectedStep = useVidgenStore((state) => state.selectedSteps[projectId])
  const selectStep = useVidgenStore((state) => state.selectStep)
  const approveStoryboard = useVidgenStore((state) => state.approveStoryboard)
  const generateScript = useVidgenStore((state) => state.generateScript)
  const resolveMaterial = useVidgenStore((state) => state.resolveMaterial)
  const generateVoiceovers = useVidgenStore((state) => state.generateVoiceovers)
  const railRef = useRef<HTMLDivElement>(null)

  if (!project) return null

  const steps = deriveSteps(project, events, inFlight)
  const selected = selectedStep ?? activeStep(steps)
  const detailStep = steps.find((s) => s.key === selected) ?? steps[0]

  // Retry the failed step, mirroring StepDetail's mapping (single retry path).
  function retryFailedStep(): void {
    const fail = lastFailure(events)
    switch (fail ? retryCommandFor(fail.stage) : undefined) {
      case 'GenerateScript':
        void generateScript({ projectId })
        break
      case 'ResolveMaterial':
        void resolveMaterial({ projectId })
        break
      case 'GenerateVoiceovers':
        void generateVoiceovers({ projectId })
        break
    }
  }

  // Keyboard control for the rail (ARIA toolbar): arrow/Home/End rove the
  // selection + focus; scoped action hotkeys act on the selected step. Bound on
  // the rail, so it never fires while typing elsewhere (e.g. the create form).
  function onRailKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const idx = steps.findIndex((s) => s.key === selected)
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const next =
        e.key === 'ArrowRight' ? Math.min(steps.length - 1, idx + 1)
        : e.key === 'ArrowLeft' ? Math.max(0, idx - 1)
        : e.key === 'Home' ? 0
        : steps.length - 1
      const key = steps[next].key
      selectStep(projectId, key)
      railRef.current?.querySelector<HTMLButtonElement>(`[data-testid="pipeline-node-${key}"]`)?.focus()
      return
    }
    const action = hotkeyFor(detailStep, e.key)
    if (!action) return
    e.preventDefault()
    if (action === 'approve') void approveStoryboard({ projectId })
    else if (action === 'reject') void generateScript({ projectId })
    else retryFailedStep()
  }

  const created = events.find((e) => e.type === 'ProjectCreated')
  const idea = created?.type === 'ProjectCreated' ? created.idea : (project.scenes[0]?.narration ?? '')

  return (
    <article className="vg-pipeline-card" data-testid={`project-card-${projectId}`}>
      <div className="vg-pipeline-card__head">
        <span className="vg-pipeline-card__id">{projectId}</span>
        <span className={`vg-status vg-status--${project.status}`}>{project.status}</span>
        <span className="vg-pipeline-card__idea">{idea}</span>
        <span className="vg-pipeline-card__cap">{t('pipeline.cap')} ${capUsd(events)}</span>
        <CostBadge projectId={projectId} />
      </div>

      <div
        ref={railRef}
        className="vg-pipeline-card__rail"
        role="toolbar"
        aria-label="Pipeline stages"
        aria-orientation="horizontal"
        onKeyDown={onRailKeyDown}
      >
        {steps.map((step, i) => (
          <Fragment key={step.key}>
            <PipelineNode
              step={step}
              scenes={project.scenes}
              status={step.state}
              selected={step.key === selected}
              tabIndex={step.key === selected ? 0 : -1}
              onSelect={() => selectStep(projectId, step.key)}
            />
            {i < steps.length - 1 && <div className={edgeClass(steps, i)} />}
          </Fragment>
        ))}
      </div>

      <div className="vg-pipeline-card__foot">
        <StepDetail projectId={projectId} step={detailStep} project={project} />
        <EventLog projectId={projectId} />
      </div>
    </article>
  )
}
