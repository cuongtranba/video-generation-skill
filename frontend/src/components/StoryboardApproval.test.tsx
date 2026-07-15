import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useVidgenStore } from '../store/store'
import { DEFAULT_STYLE } from '../store/events'
import { StoryboardApproval } from './StoryboardApproval'

// bun:test has no `vi.stubGlobal`/`vi.unstubAllGlobals` — reset `fetch` to
// its real value directly so a stub set by one test can't leak into the next.
const realFetch = globalThis.fetch

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
  globalThis.fetch = realFetch
})

describe('StoryboardApproval', () => {
  it('renders nothing before the project reaches awaiting_approval', () => {
    useVidgenStore.setState({
      projects: { p1: { projectId: 'p1', status: 'scripted', scenes: [], spentUsd: 0, approved: false, style: DEFAULT_STYLE, captionsReady: false, language: 'English' } },
    })
    render(<StoryboardApproval projectId="p1" />)
    expect(screen.queryByTestId('storyboard-approval')).not.toBeInTheDocument()
  })

  it('renders the contact sheet once status is awaiting_approval, and Approve dispatches approveStoryboard', async () => {
    // This state is exactly what applyEvent('vidgen.evt.p1.AwaitingApproval', {...})
    // would fold into projects.p1, per events.test.ts and store.test.ts.
    useVidgenStore.setState({
      projects: {
        p1: {
          projectId: 'p1', status: 'awaiting_approval', approved: false, spentUsd: 0, style: DEFAULT_STYLE, captionsReady: false, language: 'English',
          scenes: [{ idx: 0, narration: 'n', visual: 'v' }],
        },
      },
    })
    const fetchMock = mock(async () => new Response(null, { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    render(<StoryboardApproval projectId="p1" />)
    expect(screen.getByTestId('storyboard-approval')).toBeInTheDocument()
    expect(screen.getByText('n')).toBeInTheDocument() // scene narration, via SceneStrip

    await userEvent.click(screen.getByRole('button', { name: 'Approve storyboard' }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/commands/ApproveStoryboard')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.projectId).toBe('p1')
  })
})
