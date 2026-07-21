import { useVidgenStore } from '../store/store'
import { EmptyState } from '../ui/EmptyState'
import { ProjectCard } from './ProjectCard'

export function Board() {
  // Select the stable `projects` object (a fresh Object.keys(...) array from the
  // selector would re-render every commit under zustand v5's Object.is equality).
  const projects = useVidgenStore((state) => state.projects)
  const projectIds = Object.keys(projects)

  if (projectIds.length === 0) {
    return <EmptyState className="vg-board--empty">No projects yet</EmptyState>
  }

  return (
    <div className="vg-board">
      {projectIds.map((id) => (
        <ProjectCard key={id} projectId={id} />
      ))}
    </div>
  )
}
