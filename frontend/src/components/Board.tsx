import { useVidgenStore } from '../store/store'
import { PipelineCard } from './PipelineCard'

// In-UI key for the tally vocabulary the nodes speak (impeccable audit P2 —
// Nielsen H10: the color language was otherwise undocumented on screen).
// Board-level, rendered once below the cards, never per card.
const LEGEND = [
  { state: 'done', label: 'done' },
  { state: 'running', label: 'running' },
  { state: 'awaiting', label: 'awaiting' },
  { state: 'failed', label: 'failed' },
  { state: 'pending', label: 'pending' },
] as const

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
        <PipelineCard key={id} projectId={id} />
      ))}
      <footer className="vg-legend" data-testid="board-legend" aria-label="Pipeline state legend">
        {LEGEND.map(({ state, label }) => (
          <span key={state} className="vg-legend__item" data-state={state}>
            <span className="vg-legend__tally" />
            {label}
          </span>
        ))}
        <span className="vg-legend__item vg-legend__item--edge">
          <span className="vg-legend__edge" />
          flowing
        </span>
      </footer>
    </div>
  )
}
