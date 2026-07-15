import { beforeEach, describe, expect, it } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import { useVidgenStore } from '../store/store'
import { DEFAULT_STYLE } from '../store/events'
import { TunePanel } from './TunePanel'

const VOICES = ['banmai', 'thuminh', 'lannhi', 'linhsan', 'leminh', 'giahuy', 'myan']

beforeEach(() => {
  useVidgenStore.setState({
    projects: {
      p1: { projectId: 'p1', status: 'draft', scenes: [], spentUsd: 0, approved: false, style: DEFAULT_STYLE },
    },
    eventLog: {}, connection: 'down', selectedId: undefined, _unsubscribe: undefined,
  })
})

describe('TunePanel', () => {
  it('renders voice select with all 7 options', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    const select = screen.getByRole('combobox', { name: /voice/i }) as HTMLSelectElement
    expect(select).toBeInTheDocument()
    for (const v of VOICES) {
      expect(screen.getByRole('option', { name: new RegExp(v, 'i') })).toBeInTheDocument()
    }
  })

  it('renders a speed slider bounded to the api range', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    const slider = screen.getByRole('slider', { name: /speed/i }) as HTMLInputElement
    expect(slider).toBeInTheDocument()
    expect(slider.min).toBe('-3')
    expect(slider.max).toBe('3')
  })

  it('renders an editable caption font input (typing is not swallowed)', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    const font = screen.getByRole('textbox', { name: /caption font name/i }) as HTMLInputElement
    fireEvent.change(font, { target: { value: 'Roboto' } })
    expect(font.value).toBe('Roboto')
  })

  it('is read-only when disabled=true', () => {
    render(<TunePanel projectId="p1" disabled={true} />)
    // The panel wraps its controls in a disabled <fieldset>, so the voice
    // select is disabled by ancestry (toBeDisabled walks up; select.disabled
    // stays false because the attribute is on the fieldset, not the select).
    expect(screen.getByRole('combobox', { name: /voice/i })).toBeDisabled()
    expect(screen.getByTestId('tune-panel-lock')).toBeInTheDocument()
  })

  it('renders a file upload control', () => {
    render(<TunePanel projectId="p1" disabled={false} />)
    expect(screen.getByTestId('asset-dropzone')).toBeInTheDocument()
    expect(screen.getByLabelText(/upload local assets/i)).toBeInTheDocument()
  })
})
