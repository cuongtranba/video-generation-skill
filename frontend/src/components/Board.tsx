import { useVidgenStore } from '../store/store'
import { ProjectCard } from './ProjectCard'

export function Board() {
  // Select the stable `projects` object (a fresh Object.keys(...) array from the
  // selector would re-render every commit under zustand v5's Object.is equality).
  const projects = useVidgenStore((state) => state.projects)
  const projectIds = Object.keys(projects)

  if (projectIds.length === 0) {
    return <p className="vg-board vg-board--empty">No projects yet</p>
  }

  return (
    <div className="vg-board">
      {projectIds.map((id) => (
        <ProjectCard key={id} projectId={id} />
      ))}
    </div>
  )
}
