import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { CreateProjectForm } from './CreateProjectForm'

const realFetch = globalThis.fetch

beforeEach(() => {
  useVidgenStore.setState({ projects: {}, eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined })
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('CreateProjectForm', () => {
  it('renders a freeform language field defaulting to Vietnamese', () => {
    render(<CreateProjectForm />)
    const lang = screen.getByLabelText(/ngôn ngữ lời thoại/i) as HTMLInputElement
    expect(lang).toBeInTheDocument()
    expect(lang.value).toBe('Vietnamese')
  })

  it('submits CreateProject with the chosen language', async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({ projectId: 'p1' }), { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<CreateProjectForm />)

    fireEvent.change(screen.getByLabelText(/ý tưởng/i), { target: { value: 'a snail race' } })
    fireEvent.change(screen.getByLabelText(/ngôn ngữ lời thoại/i), { target: { value: 'Vietnamese' } })
    fireEvent.click(screen.getByRole('button', { name: /tạo dự án/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/commands/CreateProject')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.idea).toBe('a snail race')
    expect(body.language).toBe('Vietnamese')
    expect(body.durationSec).toBe(16)
    expect(body.sceneCount).toBe(2)
  })
})
