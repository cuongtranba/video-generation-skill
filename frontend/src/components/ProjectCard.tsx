import { useVidgenStore } from '../store/store'
import { CostBadge } from './CostBadge'
import { SceneStrip } from './SceneStrip'
import { StoryboardApproval } from './StoryboardApproval'

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
      <SceneStrip projectId={projectId} />
      <StoryboardApproval projectId={projectId} />
    </article>
  )
}
