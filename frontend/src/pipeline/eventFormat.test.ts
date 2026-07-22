import { describe, expect, it } from 'bun:test'
import type { VidgenEvent } from '../store/events'
import { formatEvent, type EventTone } from './eventFormat'

const AT = '2026-07-22T08:15:30.120Z'

describe('formatEvent', () => {
  const cases: Array<{ name: string; event: VidgenEvent; type: string; msg: string; tone: EventTone }> = [
    {
      name: 'ProjectCreated',
      event: { v: 1, type: 'ProjectCreated', projectId: 'p1', at: AT, idea: 'x', durationSec: 30, sceneCount: 2, tone: 'calm', language: 'Vietnamese' },
      type: 'project.created',
      msg: 'idea accepted · 2 scenes · 30s',
      tone: 'neutral',
    },
    {
      name: 'ScriptGenerated',
      event: { v: 1, type: 'ScriptGenerated', projectId: 'p1', at: AT, scenes: [{ idx: 0, narration: 'a', visual: 'b' }], scriptUsd: 0.001 },
      type: 'script.done',
      msg: '1 scenes · $0.0010',
      tone: 'neutral',
    },
    {
      name: 'MaterialResolved',
      event: { v: 1, type: 'MaterialResolved', projectId: 'p1', at: AT, sceneIdx: 1, source: 'pexels', assetPath: '/media/p1/material1.mp4' },
      type: 'material.done',
      msg: 'S01 · pexels · material1.mp4',
      tone: 'neutral',
    },
    {
      name: 'VoiceSynthesized',
      event: { v: 1, type: 'VoiceSynthesized', projectId: 'p1', at: AT, sceneIdx: 0, mp3Path: '/media/p1/voice0.mp3', durationSec: 6.4, ttsUsd: 0.0013 },
      type: 'tts.done',
      msg: 'S00 · 6.4s audio · $0.0013',
      tone: 'neutral',
    },
    {
      name: 'CaptionsBuilt',
      event: { v: 1, type: 'CaptionsBuilt', projectId: 'p1', at: AT, sceneIdx: 0, assPath: '/media/p1/captions.ass' },
      type: 'captions.done',
      msg: 'S00 · captions.ass',
      tone: 'neutral',
    },
    {
      name: 'CostProjected',
      event: { v: 1, type: 'CostProjected', projectId: 'p1', at: AT, projectedUsd: 0.0026, capUsd: 0.15 },
      type: 'cost.projected',
      msg: '$0.0026 of $0.15 cap',
      tone: 'neutral',
    },
    {
      name: 'AwaitingApproval',
      event: { v: 1, type: 'AwaitingApproval', projectId: 'p1', at: AT },
      type: 'gate.waiting',
      msg: 'storyboard ready for review',
      tone: 'warn',
    },
    {
      name: 'ApprovalGranted',
      event: { v: 1, type: 'ApprovalGranted', projectId: 'p1', at: AT },
      type: 'gate.approved',
      msg: 'storyboard approved · spec frozen',
      tone: 'good',
    },
    {
      name: 'RenderCompleted',
      event: { v: 1, type: 'RenderCompleted', projectId: 'p1', at: AT, outputPath: '/media/p1/output.mp4', renderUsd: 0 },
      type: 'render.done',
      msg: 'output.mp4',
      tone: 'good',
    },
    {
      name: 'Published',
      event: { v: 1, type: 'Published', projectId: 'p1', at: AT, platform: 'tiktok', postId: 'x', url: 'https://t.example/x' },
      type: 'published',
      msg: 'tiktok · https://t.example/x',
      tone: 'good',
    },
    {
      name: 'RunFailed',
      event: { v: 1, type: 'RunFailed', projectId: 'p1', at: AT, stage: 'material', error: 'pexels: 429 rate limited' },
      type: 'material.failed',
      msg: 'pexels: 429 rate limited',
      tone: 'bad',
    },
    {
      name: 'StyleSet',
      event: { v: 1, type: 'StyleSet', projectId: 'p1', at: AT, uid: 'u', voice: 'banmai', speed: 0, captionStyle: { fontName: 'Arial', fontSize: 64 }, music: null },
      type: 'style.set',
      msg: 'voice banmai · Arial 64',
      tone: 'neutral',
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const row = formatEvent(c.event)
      expect(row.type).toBe(c.type)
      expect(row.msg).toBe(c.msg)
      expect(row.tone).toBe(c.tone)
      expect(row.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    })
  }
})
