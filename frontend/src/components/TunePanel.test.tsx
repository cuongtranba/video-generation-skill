import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { DEFAULT_STYLE } from '../store/events'
import { TunePanel } from './TunePanel'

// The singleton store dispatches through the real global fetch; happy-dom
// rejects relative URLs on about:blank, so any test that commits a tune must
// stub fetch. Reset to a benign stub before each test.
const realFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = mock(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
  useVidgenStore.setState({
    projects: {
      p1: { projectId: 'p1', status: 'draft', scenes: [], spentUsd: 0, approved: false, style: DEFAULT_STYLE, captionsReady: false, language: 'English' },
    },
    eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined, ttsProvider: 'elevenlabs',
  })
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('TunePanel', () => {
  it('shows the fixed ElevenLabs voice label (no picker)', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    expect(screen.getByTestId('tune-voice-fixed')).toBeInTheDocument()
    expect(screen.getByTestId('tune-voice-fixed').textContent).toMatch(/elevenlabs/i)
    // The FPT voice dropdown and speed slider are gone entirely.
    expect(screen.queryByRole('combobox', { name: /voice/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: /speed/i })).not.toBeInTheDocument()
  })

  it('renders an editable caption font input (typing is not swallowed)', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    const font = screen.getByRole('textbox', { name: /caption font name/i }) as HTMLInputElement
    fireEvent.change(font, { target: { value: 'Roboto' } })
    expect(font.value).toBe('Roboto')
  })

  it('clamps an out-of-range caption font size on blur', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    const size = screen.getByRole('spinbutton', { name: /caption font size/i }) as HTMLInputElement
    fireEvent.change(size, { target: { value: '999' } })
    expect(size.value).toBe('999')
    fireEvent.blur(size)
    expect(size.value).toBe('200')
  })

  it('is read-only when disabled=true', () => {
    render(<TunePanel projectId="p1" disabled={true} />)
    // Controls are wrapped in a disabled <fieldset>, so the caption font input
    // is disabled by ancestry (toBeDisabled walks up to the fieldset).
    expect(screen.getByRole('textbox', { name: /caption font name/i })).toBeDisabled()
    expect(screen.getByTestId('tune-panel-lock')).toBeInTheDocument()
  })

  it('renders a file upload control', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    expect(screen.getByTestId('asset-dropzone')).toBeInTheDocument()
    expect(screen.getByLabelText(/upload local assets/i)).toBeInTheDocument()
  })
})
