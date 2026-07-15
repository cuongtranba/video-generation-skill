import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useVidgenStore } from '../store/store'
import { DEFAULT_STYLE } from '../store/events'
import { ProjectCard } from './ProjectCard'

beforeEach(() => {
  useVidgenStore.setState({
    projects: { p1: { projectId: 'p1', status: 'draft', scenes: [], spentUsd: 0, approved: false, style: DEFAULT_STYLE } },
    eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined,
  })
})

describe('ProjectCard', () => {
  it('renders the project id and status', () => {
    render(<ProjectCard projectId="p1" />)
    expect(screen.getByText('p1')).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('dispatches select on click', async () => {
    render(<ProjectCard projectId="p1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(useVidgenStore.getState().selectedId).toBe('p1')
  })

  it('renders nothing for an unknown project', () => {
    render(<ProjectCard projectId="missing" />)
    expect(screen.queryByTestId('project-card-missing')).not.toBeInTheDocument()
  })
})
