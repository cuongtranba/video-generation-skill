import { describe, it, expect } from 'bun:test'
import { eventId, eventSubject, jobSubject } from './nats.js'
import type { VidgenEvent } from './events.js'

describe('eventId', () => {
  it('uses the scene idx when the event carries one', () => {
    const event: VidgenEvent = { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: 't', sceneIdx: 2, mp3Path: '/m.mp3', ttsUsd: 0.001 }
    expect(eventId(event)).toBe('VoiceSynthesized-p1-2')
  })

  it("uses '-' when the event has no scene idx", () => {
    const event: VidgenEvent = { v: 1, type: 'ProjectCreated', projectId: 'p1', at: 't', idea: 'x', durationSec: 30, sceneCount: 3, tone: 'casual' }
    expect(eventId(event)).toBe('ProjectCreated-p1--')
  })
})

describe('eventSubject', () => {
  it('builds vidgen.evt.<projectId>.<type>', () => {
    const event: VidgenEvent = { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: 't' }
    expect(eventSubject(event)).toBe('vidgen.evt.p1.AwaitingApproval')
  })
})

describe('jobSubject', () => {
  it('builds vidgen.job.<kind>.<projectId>.<scene>', () => {
    expect(jobSubject('tts', 'p1', 2)).toBe('vidgen.job.tts.p1.2')
  })

  it("uses '-' for a project-level job with no scene", () => {
    expect(jobSubject('render', 'p1', null)).toBe('vidgen.job.render.p1.-')
  })
})
