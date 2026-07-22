import { useTranslation } from 'react-i18next'
import { useVidgenStore } from '../store/store'
import { PipelineCard } from './PipelineCard'

// In-UI key for the tally vocabulary the nodes speak (impeccable audit P2 —
// Nielsen H10: the color language was otherwise undocumented on screen).
// Board-level, rendered once below the cards, never per card. Labels come from
// i18n (legend.<state>), so the vocabulary is translated like everything else.
const LEGEND_STATES = ['done', 'running', 'awaiting', 'failed', 'pending'] as const

export function Board() {
  const { t } = useTranslation()
  // Select the stable `projects` object (a fresh Object.keys(...) array from the
  // selector would re-render every commit under zustand v5's Object.is equality).
  const projects = useVidgenStore((state) => state.projects)
  const projectIds = Object.keys(projects)

  if (projectIds.length === 0) {
    return <p className="vg-board vg-board--empty">{t('board.empty')}</p>
  }

  return (
    <div className="vg-board">
      {projectIds.map((id) => (
        <PipelineCard key={id} projectId={id} />
      ))}
      <footer className="vg-legend" data-testid="board-legend" aria-label={t('legend.aria')}>
        {LEGEND_STATES.map((state) => (
          <span key={state} className="vg-legend__item" data-state={state}>
            <span className="vg-legend__tally" />
            {t(`legend.${state}`)}
          </span>
        ))}
        <span className="vg-legend__item vg-legend__item--edge">
          <span className="vg-legend__edge" />
          {t('legend.flowing')}
        </span>
      </footer>
    </div>
  )
}
