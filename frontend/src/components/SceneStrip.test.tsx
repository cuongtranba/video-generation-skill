import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { DEFAULT_STYLE } from '../store/events'
import { SceneStrip } from './SceneStrip'

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})

describe('SceneStrip', () => {
  it('renders each scene narration', () => {
    useVidgenStore.setState({
      projects: {
        p1: {
          projectId: 'p1', status: 'scripted', spentUsd: 0, approved: false, style: DEFAULT_STYLE,
          scenes: [
            { idx: 0, narration: 'A cat wakes up', visual: 'sunrise' },
            { idx: 1, narration: 'The cat stretches', visual: 'yawn' },
          ],
        },
      },
    })
    render(<SceneStrip projectId="p1" />)
    expect(screen.getByText('A cat wakes up')).toBeInTheDocument()
    expect(screen.getByText('The cat stretches')).toBeInTheDocument()
  })

  it('renders an empty state with no scenes', () => {
    render(<SceneStrip projectId="p1" />)
    expect(screen.getByText('No scenes yet')).toBeInTheDocument()
  })
})
