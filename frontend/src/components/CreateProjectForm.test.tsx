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
  it('renders a language select limited to Vietnamese and English, defaulting to Vietnamese', () => {
    render(<CreateProjectForm />)
    const lang = screen.getByLabelText(/ngôn ngữ lời thoại/i) as HTMLSelectElement
    expect(lang.tagName).toBe('SELECT')
    expect(lang.value).toBe('Vietnamese')
    const values = Array.from(lang.options).map((o) => o.value)
    expect(values).toEqual(['Vietnamese', 'English'])
  })

  it('submits CreateProject with the defaults 60s / 6 scenes', async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({ projectId: 'p1' }), { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<CreateProjectForm />)

    fireEvent.change(screen.getByLabelText(/ý tưởng/i), { target: { value: 'a snail race' } })
    fireEvent.click(screen.getByRole('button', { name: /tạo dự án/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/commands/CreateProject')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.idea).toBe('a snail race')
    expect(body.language).toBe('Vietnamese')
    expect(body.durationSec).toBe(60)
    expect(body.sceneCount).toBe(6)
  })

  it('submits CreateProject with English when selected', async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({ projectId: 'p1' }), { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    render(<CreateProjectForm />)

    fireEvent.change(screen.getByLabelText(/ý tưởng/i), { target: { value: 'a snail race' } })
    fireEvent.change(screen.getByLabelText(/ngôn ngữ lời thoại/i), { target: { value: 'English' } })
    fireEvent.click(screen.getByRole('button', { name: /tạo dự án/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.language).toBe('English')
  })
})
