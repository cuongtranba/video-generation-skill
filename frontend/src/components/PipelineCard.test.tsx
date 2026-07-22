import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useVidgenStore } from '../store/store'
import { foldProject, type VidgenEvent } from '../store/events'
import { PipelineCard } from './PipelineCard'

function seed(events: VidgenEvent[]): void {
  const projectId = events[0]?.projectId ?? 'p1'
  useVidgenStore.setState({
    projects: { [projectId]: foldProject(events) },
    eventLog: { [projectId]: events },
    inFlight: {},
    selectedSteps: {},
  })
}

const CREATED: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-22T08:00:00Z', idea: 'lợi ích của việc uống nước ấm buổi sáng', durationSec: 30, sceneCount: 2, tone: 'calm', language: 'Vietnamese' }
const SCRIPTED: VidgenEvent = { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-22T08:00:02Z', scenes: [{ idx: 0, narration: 'Nước ấm đánh thức hệ tiêu hóa', visual: 'glass of water' }, { idx: 1, narration: 'Uống trước bữa sáng', visual: 'sunrise window' }], scriptUsd: 0.001 }

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, inFlight: {}, selectedSteps: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})

describe('PipelineCard', () => {
  it('renders the six pipeline nodes and the project idea', () => {
    seed([CREATED, SCRIPTED])
    render(<PipelineCard projectId="p1" />)
    for (const key of ['script', 'material', 'voice', 'captions', 'gate', 'render']) {
      expect(screen.getByTestId(`pipeline-node-${key}`)).toBeInTheDocument()
    }
    expect(screen.getByText('lợi ích của việc uống nước ấm buổi sáng')).toBeInTheDocument()
    expect(screen.getByText('giới hạn $0.15')).toBeInTheDocument()
  })

  it('marks the script node done and material as the active step after scripting', () => {
    seed([CREATED, SCRIPTED])
    render(<PipelineCard projectId="p1" />)
    expect(screen.getByTestId('pipeline-node-script')).toHaveAttribute('data-state', 'done')
    expect(screen.getByTestId('pipeline-node-material')).toHaveAttribute('data-state', 'pending')
  })

  it('shows the script narration in the detail panel when the script node is selected', async () => {
    seed([CREATED, SCRIPTED])
    render(<PipelineCard projectId="p1" />)
    await userEvent.click(screen.getByTestId('pipeline-node-script'))
    const detail = screen.getByTestId('step-detail')
    expect(within(detail).getByText('Nước ấm đánh thức hệ tiêu hóa')).toBeInTheDocument()
  })

  it('offers the approve button when the gate is awaiting approval', () => {
    const events: VidgenEvent[] = [
      CREATED, SCRIPTED,
      { v: 1, type: 'MaterialResolved', projectId: 'p1', at: '2026-07-22T08:00:03Z', sceneIdx: 0, source: 'pexels', assetPath: '/media/p1/material0.mp4' },
      { v: 1, type: 'MaterialResolved', projectId: 'p1', at: '2026-07-22T08:00:03Z', sceneIdx: 1, source: 'local', assetPath: '/media/p1/material1.mp4' },
      { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: '2026-07-22T08:00:04Z', sceneIdx: 0, mp3Path: '/media/p1/tts0.mp3', durationSec: 6.4, ttsUsd: 0.0013 },
      { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: '2026-07-22T08:00:04Z', sceneIdx: 1, mp3Path: '/media/p1/tts1.mp3', durationSec: 7.1, ttsUsd: 0.0013 },
      { v: 1, type: 'CaptionsBuilt', projectId: 'p1', at: '2026-07-22T08:00:05Z', sceneIdx: 0, assPath: '/media/p1/captions.ass' },
      { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: '2026-07-22T08:00:06Z' },
    ]
    seed(events)
    render(<PipelineCard projectId="p1" />)
    expect(screen.getByTestId('pipeline-node-gate')).toHaveAttribute('data-state', 'awaiting')
    expect(screen.getByRole('button', { name: 'Phê duyệt storyboard' })).toBeInTheDocument()
  })

  it('shows the failure error and a retry button when a step failed', () => {
    const events: VidgenEvent[] = [
      CREATED, SCRIPTED,
      { v: 1, type: 'RunFailed', projectId: 'p1', at: '2026-07-22T08:00:03Z', stage: 'material', error: 'pexels: 429 rate limited' },
    ]
    seed(events)
    render(<PipelineCard projectId="p1" />)
    expect(screen.getByTestId('pipeline-node-material')).toHaveAttribute('data-state', 'failed')
    const detail = screen.getByTestId('step-detail')
    expect(within(detail).getByText('pexels: 429 rate limited')).toBeInTheDocument()
    expect(within(detail).getByRole('button', { name: 'Thử lại bước' })).toBeInTheDocument()
  })

  it('renders worker event rows in the log', () => {
    seed([CREATED, SCRIPTED])
    render(<PipelineCard projectId="p1" />)
    const log = screen.getByTestId('event-log')
    expect(within(log).getByText('project.created')).toBeInTheDocument()
    expect(within(log).getByText('script.done')).toBeInTheDocument()
  })

  it('renders nothing for an unknown project', () => {
    const { container } = render(<PipelineCard projectId="ghost" />)
    expect(container).toBeEmptyDOMElement()
  })
})
