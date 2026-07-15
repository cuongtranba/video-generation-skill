import { describe, it, expect } from 'bun:test'
import { buildScriptPrompt, mapScriptGeneratedEvent, parseScenes, scriptSchema, stubScriptGenerator, type ScriptInput } from './script.js'
import type { Scene } from './events.js'

describe('stubScriptGenerator', () => {
  it('returns exactly sceneCount scenes with sequential idx starting at 0', async () => {
    const { scenes } = await stubScriptGenerator.generateScenes('nước ấm', 30, 3, 'casual', 'Vietnamese')
    expect(scenes.map((s) => s.idx)).toEqual([0, 1, 2])
    for (const scene of scenes) {
      expect(scene.narration.length).toBeGreaterThan(0)
      expect(scene.visual.length).toBeGreaterThan(0)
    }
  })
})

describe('buildScriptPrompt', () => {
  it('injects the chosen language, idea, duration, scene count, and tone', () => {
    const input: ScriptInput = { idea: 'a snail wins a tiny race', durationSec: 45, sceneCount: 5, tone: 'energetic' }
    const prompt = buildScriptPrompt(input, 'Vietnamese')
    expect(prompt).toContain('45 seconds')
    expect(prompt).toContain('5 scenes')
    expect(prompt).toContain('a snail wins a tiny race')
    expect(prompt).toContain('energetic')
    expect(prompt).toContain('narration entirely in Vietnamese')
  })

  it('defaults to English when no language is given', () => {
    const input: ScriptInput = { idea: 'x', durationSec: 30, sceneCount: 3, tone: 'casual' }
    expect(buildScriptPrompt(input)).toContain('narration entirely in English')
  })
})

describe('scriptSchema', () => {
  it('requires a scenes array with narration and visual per item', () => {
    expect(scriptSchema.required).toEqual(['scenes'])
    expect(scriptSchema.properties.scenes.items.required).toEqual(['narration', 'visual'])
  })
})

describe('parseScenes', () => {
  it('maps valid structured output to Scene[] with idx assigned by array position', () => {
    const scenes = parseScenes({
      scenes: [
        { narration: 'Xin chào, bạn có biết uống nước ấm rất tốt?', visual: 'close-up khuôn mặt tươi cười' },
        { narration: 'Uống một cốc nước ấm mỗi sáng', visual: 'cốc nước ấm bốc hơi nhẹ' },
      ],
    })
    expect(scenes).toEqual([
      { idx: 0, narration: 'Xin chào, bạn có biết uống nước ấm rất tốt?', visual: 'close-up khuôn mặt tươi cười' },
      { idx: 1, narration: 'Uống một cốc nước ấm mỗi sáng', visual: 'cốc nước ấm bốc hơi nhẹ' },
    ])
  })

  it('throws when structured output is not an object', () => {
    expect(() => parseScenes(undefined)).toThrow(/expected object/)
  })

  it('throws when "scenes" is missing or not an array', () => {
    expect(() => parseScenes({})).toThrow(/expected "scenes" to be an array/)
  })

  it('throws when a scene item is missing narration or visual', () => {
    expect(() => parseScenes({ scenes: [{ visual: 'chỉ có visual' }] })).toThrow(/missing narration/)
    expect(() => parseScenes({ scenes: [{ narration: 'chỉ có narration' }] })).toThrow(/missing visual/)
  })
})

describe('mapScriptGeneratedEvent', () => {
  it('always sets the event scriptUsd to 0 and keeps notionalUsd separate', () => {
    const scenes: Scene[] = [{ idx: 0, narration: 'Xin chào', visual: 'cảnh mở đầu' }]
    const mapping = mapScriptGeneratedEvent('p1', '2026-07-09T00:00:00Z', { scenes, notionalUsd: 0.214275 })

    expect(mapping.event).toEqual({
      v: 1,
      type: 'ScriptGenerated',
      projectId: 'p1',
      at: '2026-07-09T00:00:00Z',
      scenes,
      scriptUsd: 0,
    })
    expect(mapping.notionalUsd).toBeCloseTo(0.214275)
  })

  it('sets scriptUsd to 0 even when notionalUsd is 0', () => {
    const mapping = mapScriptGeneratedEvent('p2', '2026-07-09T00:00:00Z', { scenes: [], notionalUsd: 0 })
    expect(mapping.event.scriptUsd).toBe(0)
    expect(mapping.notionalUsd).toBe(0)
  })
})
