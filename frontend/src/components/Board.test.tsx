import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
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
        p1: { projectId: 'p1', status: 'draft', scenes: [], spentUsd: 0, approved: false },
        p2: { projectId: 'p2', status: 'scripted', scenes: [], spentUsd: 0, approved: false },
      },
    })
    render(<Board />)
    expect(screen.getByTestId('project-card-p1')).toBeInTheDocument()
    expect(screen.getByTestId('project-card-p2')).toBeInTheDocument()
  })
})
