import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { useVidgenStore } from '../store/store'
import { foldProject, type VidgenEvent } from '../store/events'
import { PipelineCard } from './PipelineCard'

const CREATED: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: '2026-07-22T08:00:00Z', idea: 'nước ấm buổi sáng', durationSec: 30, sceneCount: 2, tone: 'calm', language: 'Vietnamese' }
const SCRIPTED: VidgenEvent = { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: '2026-07-22T08:00:02Z', scenes: [{ idx: 0, narration: 'a', visual: 'x' }, { idx: 1, narration: 'b', visual: 'y' }], scriptUsd: 0.001 }

const AWAITING: VidgenEvent[] = [
  CREATED, SCRIPTED,
  { v: 1, type: 'MaterialResolved', projectId: 'p1', at: '2026-07-22T08:00:03Z', sceneIdx: 0, source: 'pexels', assetPath: '/media/p1/material0.mp4' },
  { v: 1, type: 'MaterialResolved', projectId: 'p1', at: '2026-07-22T08:00:03Z', sceneIdx: 1, source: 'local', assetPath: '/media/p1/material1.mp4' },
  { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: '2026-07-22T08:00:04Z', sceneIdx: 0, mp3Path: '/media/p1/tts0.mp3', durationSec: 6.4, ttsUsd: 0.0013 },
  { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: '2026-07-22T08:00:04Z', sceneIdx: 1, mp3Path: '/media/p1/tts1.mp3', durationSec: 7.1, ttsUsd: 0.0013 },
  { v: 1, type: 'CaptionsBuilt', projectId: 'p1', at: '2026-07-22T08:00:05Z', sceneIdx: 0, assPath: '/media/p1/captions.ass' },
  { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: '2026-07-22T08:00:06Z' },
]

const FAILED: VidgenEvent[] = [
  CREATED, SCRIPTED,
  { v: 1, type: 'RunFailed', projectId: 'p1', at: '2026-07-22T08:00:03Z', stage: 'material', error: 'pexels: 429' },
]

type Overrides = Partial<Parameters<typeof useVidgenStore.setState>[0]>

function seed(events: VidgenEvent[], overrides: Overrides = {}): void {
  useVidgenStore.setState({ projects: { p1: foldProject(events) }, eventLog: { p1: events }, inFlight: {}, selectedSteps: {}, ...overrides })
}

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, inFlight: {}, selectedSteps: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})

describe('PipelineCard keyboard control', () => {
  it('moves selection to the next node on ArrowRight and focuses it', async () => {
    const user = userEvent.setup()
    seed(AWAITING)
    render(<PipelineCard projectId="p1" />)
    await user.click(screen.getByTestId('pipeline-node-script'))
    await user.keyboard('{ArrowRight}')
    const material = screen.getByTestId('pipeline-node-material')
    expect(material).toHaveClass('vg-node--selected')
    expect(material).toHaveFocus()
  })

  it('clamps at the first node on ArrowLeft', async () => {
    const user = userEvent.setup()
    seed(AWAITING)
    render(<PipelineCard projectId="p1" />)
    await user.click(screen.getByTestId('pipeline-node-script'))
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByTestId('pipeline-node-script')).toHaveClass('vg-node--selected')
  })

  it('jumps to the last node on End and first on Home', async () => {
    const user = userEvent.setup()
    seed(AWAITING)
    render(<PipelineCard projectId="p1" />)
    await user.click(screen.getByTestId('pipeline-node-script'))
    await user.keyboard('{End}')
    expect(screen.getByTestId('pipeline-node-render')).toHaveClass('vg-node--selected')
    await user.keyboard('{Home}')
    expect(screen.getByTestId('pipeline-node-script')).toHaveClass('vg-node--selected')
  })

  it('gives only the selected node a positive tabindex (roving)', async () => {
    const user = userEvent.setup()
    seed(AWAITING)
    render(<PipelineCard projectId="p1" />)
    await user.click(screen.getByTestId('pipeline-node-voice'))
    expect(screen.getByTestId('pipeline-node-voice')).toHaveAttribute('tabindex', '0')
    expect(screen.getByTestId('pipeline-node-script')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByTestId('pipeline-node-render')).toHaveAttribute('tabindex', '-1')
  })

  it('approves on "A" when the awaiting gate node is selected', async () => {
    const user = userEvent.setup()
    const approveStoryboard = mock(() => Promise.resolve())
    seed(AWAITING, { approveStoryboard })
    render(<PipelineCard projectId="p1" />)
    await user.click(screen.getByTestId('pipeline-node-gate'))
    await user.keyboard('a')
    expect(approveStoryboard).toHaveBeenCalledTimes(1)
    expect(approveStoryboard).toHaveBeenCalledWith({ projectId: 'p1' })
  })

  it('rejects (rescripts) on "R" when the awaiting gate node is selected', async () => {
    const user = userEvent.setup()
    const generateScript = mock(() => Promise.resolve())
    seed(AWAITING, { generateScript })
    render(<PipelineCard projectId="p1" />)
    await user.click(screen.getByTestId('pipeline-node-gate'))
    await user.keyboard('r')
    expect(generateScript).toHaveBeenCalledWith({ projectId: 'p1' })
  })

  it('retries on "R" when a failed node is selected', async () => {
    const user = userEvent.setup()
    const resolveMaterial = mock(() => Promise.resolve())
    seed(FAILED, { resolveMaterial })
    render(<PipelineCard projectId="p1" />)
    await user.click(screen.getByTestId('pipeline-node-material'))
    await user.keyboard('r')
    expect(resolveMaterial).toHaveBeenCalledWith({ projectId: 'p1' })
  })

  it('does nothing for "A" when a non-gate node is selected', async () => {
    const user = userEvent.setup()
    const approveStoryboard = mock(() => Promise.resolve())
    seed(AWAITING, { approveStoryboard })
    render(<PipelineCard projectId="p1" />)
    await user.click(screen.getByTestId('pipeline-node-script'))
    await user.keyboard('a')
    expect(approveStoryboard).not.toHaveBeenCalled()
  })

  it('does not fire hotkeys while typing in the create-project form', async () => {
    const user = userEvent.setup()
    const approveStoryboard = mock(() => Promise.resolve())
    seed(AWAITING, { approveStoryboard })
    render(<App />)
    await user.type(screen.getByLabelText(/idea/i), 'approve')
    expect(approveStoryboard).not.toHaveBeenCalled()
  })
})
