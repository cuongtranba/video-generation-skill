import { describe, it, expect } from 'bun:test'
import type { VidgenEvent } from './events.js'
import {
  assertCanCreate,
  assertExists,
  assertTransition,
  InvalidTransitionError,
  ProjectNotFoundError,
  ProjectAlreadyExistsError,
} from './aggregate.js'

const created: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't', idea: 'x', durationSec: 30, sceneCount: 1, tone: 'casual', language: 'English' }
const scripted: VidgenEvent = { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: 't', scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0 }

describe('assertCanCreate', () => {
  it('allows creating a project with no prior events', () => {
    expect(() => assertCanCreate([], 'p1')).not.toThrow()
  })

  it('rejects creating a project that already has events', () => {
    expect(() => assertCanCreate([created], 'p1')).toThrow(ProjectAlreadyExistsError)
  })
})

describe('assertExists', () => {
  it('throws ProjectNotFoundError for an empty log', () => {
    expect(() => assertExists([], 'p1')).toThrow(ProjectNotFoundError)
  })

  it('returns the folded state for a non-empty log', () => {
    const state = assertExists([created], 'p1')
    expect(state.status).toBe('draft')
  })
})

describe('assertTransition', () => {
  it('allows GenerateScript from draft', () => {
    const state = assertExists([created], 'p1')
    expect(() => assertTransition('GenerateScript', state)).not.toThrow()
  })

  it('rejects GenerateScript from scripted (already scripted)', () => {
    const state = assertExists([created, scripted], 'p1')
    expect(() => assertTransition('GenerateScript', state)).toThrow(InvalidTransitionError)
  })

  it('allows ResolveMaterial from scripted', () => {
    const state = assertExists([created, scripted], 'p1')
    expect(() => assertTransition('ResolveMaterial', state)).not.toThrow()
  })

  it('rejects Publish before rendered', () => {
    const state = assertExists([created, scripted], 'p1')
    expect(() => assertTransition('Publish', state)).toThrow(InvalidTransitionError)
  })
})
