import { describe, it, expect } from 'bun:test'
import { HttpError, requireProjectId, parseCreateProjectInput, parsePublishInput, guardProjectId } from './http.js'

describe('requireProjectId', () => {
  it('returns projectId when present', () => {
    expect(requireProjectId({ projectId: 'p1' })).toBe('p1')
  })

  it('throws HttpError(400) when missing', () => {
    expect(() => requireProjectId({})).toThrow(HttpError)
  })
})

describe('parseCreateProjectInput', () => {
  it('parses a valid body', () => {
    const input = parseCreateProjectInput({ idea: 'x', durationSec: 30, sceneCount: 3, tone: 'casual' })
    expect(input).toEqual({ idea: 'x', durationSec: 30, sceneCount: 3, tone: 'casual' })
  })

  it('rejects a body missing durationSec', () => {
    expect(() => parseCreateProjectInput({ idea: 'x', sceneCount: 3, tone: 'casual' })).toThrow(HttpError)
  })
})

describe('parsePublishInput', () => {
  it('parses a valid body', () => {
    const input = parsePublishInput({ projectId: 'p1', caption: 'hi', privacy: 'public' })
    expect(input).toEqual({ projectId: 'p1', caption: 'hi', privacy: 'public' })
  })

  it('rejects a body missing caption', () => {
    expect(() => parsePublishInput({ projectId: 'p1', privacy: 'public' })).toThrow(HttpError)
  })
})

describe('guardProjectId', () => {
  it('accepts a normal uuid-style projectId', () => {
    expect(() => guardProjectId('abc123-def')).not.toThrow()
  })

  it('rejects ".."', () => {
    expect(() => guardProjectId('..')).toThrow(HttpError)
  })

  it('rejects "."', () => {
    expect(() => guardProjectId('.')).toThrow(HttpError)
  })

  it('rejects a projectId containing a forward slash', () => {
    expect(() => guardProjectId('p1/../../etc')).toThrow(HttpError)
  })

  it('rejects a projectId containing a backslash', () => {
    expect(() => guardProjectId('p1\\evil')).toThrow(HttpError)
  })
})
