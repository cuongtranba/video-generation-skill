import { useVidgenStore } from '../store/store'
import { CostBadge } from './CostBadge'
import { SceneStrip } from './SceneStrip'
import { StoryboardApproval } from './StoryboardApproval'
import { TunePanel } from './TunePanel'

// TuneProject is rejected by the api once the storyboard is approved, so the
// panel goes read-only for any status outside this set.
const TUNABLE_STATUSES = ['draft', 'scripted', 'material', 'awaiting_approval']

interface ProjectCardProps {
  projectId: string
}

export function ProjectCard({ projectId }: ProjectCardProps) {
  const status = useVidgenStore((state) => state.projects[projectId]?.status)
  const select = useVidgenStore((state) => state.select)

  if (!status) {
    return null
  }

  return (
    <article className="vg-project-card" data-testid={`project-card-${projectId}`}>
      <header>
        <h2>{projectId}</h2>
        <span>{status}</span>
        <CostBadge projectId={projectId} />
      </header>
      <button type="button" onClick={() => select(projectId)}>
        Select
      </button>
      <TunePanel projectId={projectId} disabled={!TUNABLE_STATUSES.includes(status)} />
      <SceneStrip projectId={projectId} />
      <StoryboardApproval projectId={projectId} />
    </article>
  )
}
