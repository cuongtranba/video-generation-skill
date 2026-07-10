import { Button } from '../ui/Button'
import { useVidgenStore } from '../store/store'
import { SceneStrip } from './SceneStrip'

interface StoryboardApprovalProps {
  projectId: string
}

export function StoryboardApproval({ projectId }: StoryboardApprovalProps) {
  const status = useVidgenStore((state) => state.projects[projectId]?.status)
  const approveStoryboard = useVidgenStore((state) => state.approveStoryboard)

  if (status !== 'awaiting_approval') {
    return null
  }

  return (
    <section className="vg-approval" data-testid="storyboard-approval">
      <h3>Approve storyboard</h3>
      <SceneStrip projectId={projectId} />
      <Button onClick={() => void approveStoryboard({ projectId })}>Approve storyboard</Button>
    </section>
  )
}
