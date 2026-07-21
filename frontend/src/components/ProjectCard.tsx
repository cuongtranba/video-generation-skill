import { useVidgenStore } from '../store/store'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
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
    <Card
      className="vg-project-card"
      data-testid={`project-card-${projectId}`}
      title={projectId}
      meta={status}
      actions={<CostBadge projectId={projectId} />}
    >
      <Button variant="ghost" size="sm" type="button" onClick={() => select(projectId)}>
        Select
      </Button>
      <TunePanel projectId={projectId} disabled={!TUNABLE_STATUSES.includes(status)} />
      <SceneStrip projectId={projectId} />
      <StoryboardApproval projectId={projectId} />
    </Card>
  )
}
