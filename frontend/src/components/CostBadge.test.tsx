import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { DEFAULT_STYLE } from '../store/events'
import { CostBadge } from './CostBadge'

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})

describe('CostBadge', () => {
  it('renders the project spend formatted as dollars', () => {
    useVidgenStore.setState({
      projects: { p1: { projectId: 'p1', status: 'draft', scenes: [], spentUsd: 0.045, approved: false, style: DEFAULT_STYLE } },
    })
    render(<CostBadge projectId="p1" />)
    expect(screen.getByText('$0.05')).toBeInTheDocument()
  })

  it('renders $0.00 for a project not yet in the store', () => {
    render(<CostBadge projectId="missing" />)
    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })
})
