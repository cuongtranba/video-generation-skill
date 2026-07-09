import { describe, it, expect } from 'bun:test'
import { stubScriptGenerator } from './script.js'

describe('stubScriptGenerator', () => {
  it('returns exactly sceneCount scenes with sequential idx starting at 0', async () => {
    const { scenes } = await stubScriptGenerator.generateScenes('nước ấm', 30, 3, 'casual')
    expect(scenes.map((s) => s.idx)).toEqual([0, 1, 2])
    for (const scene of scenes) {
      expect(scene.narration.length).toBeGreaterThan(0)
      expect(scene.visual.length).toBeGreaterThan(0)
    }
  })
})
