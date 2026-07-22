import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { DEFAULT_STYLE } from '../store/events'
import { Board } from './Board'

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})

describe('Board', () => {
  it('renders the empty state with no projects', () => {
    render(<Board />)
    expect(screen.getByText('No projects yet')).toBeInTheDocument()
  })

  it('renders a card per project', () => {
    useVidgenStore.setState({
      projects: {
        p1: { projectId: 'p1', status: 'draft', scenes: [], spentUsd: 0, approved: false, style: DEFAULT_STYLE, captionsReady: false, language: 'English' },
        p2: { projectId: 'p2', status: 'scripted', scenes: [], spentUsd: 0, approved: false, style: DEFAULT_STYLE, captionsReady: false, language: 'English' },
      },
    })
    render(<Board />)
    expect(screen.getByTestId('project-card-p1')).toBeInTheDocument()
    expect(screen.getByTestId('project-card-p2')).toBeInTheDocument()
  })

  it('shows one state legend below the cards documenting the tally vocabulary', () => {
    useVidgenStore.setState({
      projects: {
        p1: { projectId: 'p1', status: 'draft', scenes: [], spentUsd: 0, approved: false, style: DEFAULT_STYLE, captionsReady: false, language: 'English' },
        p2: { projectId: 'p2', status: 'scripted', scenes: [], spentUsd: 0, approved: false, style: DEFAULT_STYLE, captionsReady: false, language: 'English' },
      },
    })
    render(<Board />)
    const legends = screen.getAllByTestId('board-legend')
    expect(legends).toHaveLength(1) // board-level, not per card
    for (const label of ['done', 'running', 'awaiting', 'failed', 'pending']) {
      expect(legends[0]).toHaveTextContent(label)
    }
  })

  it('hides the legend on the empty board', () => {
    render(<Board />)
    expect(screen.queryByTestId('board-legend')).not.toBeInTheDocument()
  })
})
