import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { ConnectionStatus } from './ConnectionStatus'

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})

describe('ConnectionStatus', () => {
  it('renders Live when the store connection is live', () => {
    useVidgenStore.setState({ connection: 'live' })
    render(<ConnectionStatus />)
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('renders Disconnected when down', () => {
    render(<ConnectionStatus />)
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })

  it('renders Connecting… while connecting', () => {
    useVidgenStore.setState({ connection: 'connecting' })
    render(<ConnectionStatus />)
    expect(screen.getByText('Connecting…')).toBeInTheDocument()
  })
})
