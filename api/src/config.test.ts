import { describe, it, expect } from 'bun:test'
import { parseTtsProvider } from './config.js'

describe('parseTtsProvider', () => {
  it('reads elevenlabs from tts.provider', () => {
    expect(parseTtsProvider('tts:\n  provider: elevenlabs\n')).toBe('elevenlabs')
  })

  it('reads fpt from tts.provider', () => {
    expect(parseTtsProvider('tts:\n  provider: fpt\n  voice: banmai\n')).toBe('fpt')
  })

  it('falls back to fpt when tts section is missing', () => {
    expect(parseTtsProvider('music:\n  provider: jamendo\n')).toBe('fpt')
  })

  it('falls back to fpt for an unrecognized provider', () => {
    expect(parseTtsProvider('tts:\n  provider: azure\n')).toBe('fpt')
  })

  it('falls back to fpt for non-yaml garbage', () => {
    expect(parseTtsProvider(':::not: valid: yaml:::\n  - [')).toBe('fpt')
  })

  it('falls back to fpt for an empty document', () => {
    expect(parseTtsProvider('')).toBe('fpt')
  })
})
