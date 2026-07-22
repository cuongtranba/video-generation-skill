import { Fragment } from 'react'
import { useVidgenStore } from '../store/store'
import { CostBadge } from './CostBadge'
import { EventLog } from './EventLog'
import { PipelineNode } from './PipelineNode'
import { StepDetail } from './StepDetail'
import { activeStep, capUsd, deriveSteps, type StepInfo } from '../pipeline/derive'

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
  const project = useVidgenStore((state) => state.projects[projectId])
  const events = useVidgenStore((state) => state.eventLog[projectId]) ?? []
  const inFlight = useVidgenStore((state) => state.inFlight[projectId]) ?? {}
  const selectedStep = useVidgenStore((state) => state.selectedSteps[projectId])
  const selectStep = useVidgenStore((state) => state.selectStep)

  if (!project) return null

  const steps = deriveSteps(project, events, inFlight)
  const selected = selectedStep ?? activeStep(steps)
  const detailStep = steps.find((s) => s.key === selected) ?? steps[0]

  const created = events.find((e) => e.type === 'ProjectCreated')
  const idea = created?.type === 'ProjectCreated' ? created.idea : (project.scenes[0]?.narration ?? '')

  return (
    <article className="vg-pipeline-card" data-testid={`project-card-${projectId}`}>
      <div className="vg-pipeline-card__head">
        <span className="vg-pipeline-card__id">{projectId}</span>
        <span className={`vg-status vg-status--${project.status}`}>{project.status}</span>
        <span className="vg-pipeline-card__idea">{idea}</span>
        <span className="vg-pipeline-card__cap">cap ${capUsd(events)}</span>
        <CostBadge projectId={projectId} />
      </div>

      <div className="vg-pipeline-card__rail">
        {steps.map((step, i) => (
          <Fragment key={step.key}>
            <PipelineNode
              step={step}
              scenes={project.scenes}
              status={step.state}
              selected={step.key === selected}
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
