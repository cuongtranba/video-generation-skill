import { describe, it, expect } from 'bun:test'
import { parseTtsProvider } from './config.js'

describe('parseTtsProvider', () => {
  it('reads elevenlabs from tts.provider', () => {
    expect(parseTtsProvider('tts:\n  provider: elevenlabs\n')).toBe('elevenlabs')
  })

  it('falls back to elevenlabs when tts section is missing', () => {
    expect(parseTtsProvider('music:\n  provider: jamendo\n')).toBe('elevenlabs')
  })

  it('falls back to elevenlabs for an unrecognized provider', () => {
    expect(parseTtsProvider('tts:\n  provider: azure\n')).toBe('elevenlabs')
  })

  it('falls back to elevenlabs for non-yaml garbage', () => {
    expect(parseTtsProvider(':::not: valid: yaml:::\n  - [')).toBe('elevenlabs')
  })

  it('falls back to elevenlabs for an empty document', () => {
    expect(parseTtsProvider('')).toBe('elevenlabs')
  })
})
