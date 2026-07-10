import { Badge } from '../ui/Badge'
import { useVidgenStore } from '../store/store'

interface CostBadgeProps {
  projectId: string
}

export function CostBadge({ projectId }: CostBadgeProps) {
  const spentUsd = useVidgenStore((state) => state.projects[projectId]?.spentUsd ?? 0)
  // Round to nearest cent before formatting: (0.045).toFixed(2) is "0.04" in
  // binary float, so format the cent-rounded value instead.
  const display = (Math.round(spentUsd * 100) / 100).toFixed(2)
  return <Badge tone={spentUsd > 0.1 ? 'bad' : 'neutral'}>${display}</Badge>
}
