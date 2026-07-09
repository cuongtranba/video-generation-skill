import { describe, it, expect } from 'bun:test'
import { generateScenes, mapScriptGeneratedEvent } from './script.js'

// Live test: spawns the local `claude` CLI via the Agent SDK, authenticated by the
// machine's Claude subscription (OAuth/keychain) — NO ANTHROPIC_API_KEY is used or
// required. Budget: 1 SDK call (of the ≤2 allowed). Skipped by default.
//
// Run explicitly with:
//   cd api && RUN_LIVE_SDK_TESTS=1 bun test src/script.live.test.ts
describe.skipIf(process.env.RUN_LIVE_SDK_TESTS !== '1')('generateScenes (live)', () => {
  it('produces sceneCount scenes and maps to scriptUsd = 0', async () => {
    const input = { idea: '3 lý do bạn nên uống nước ấm mỗi sáng', durationSec: 30, sceneCount: 3, tone: 'casual' }

    const result = await generateScenes(input)

    expect(result.scenes.length).toBe(input.sceneCount)
    for (const scene of result.scenes) {
      expect(scene.narration.length).toBeGreaterThan(0)
      expect(scene.visual.length).toBeGreaterThan(0)
    }
    expect(result.notionalUsd).toBeGreaterThanOrEqual(0)

    const mapping = mapScriptGeneratedEvent('live-test-project', new Date().toISOString(), result)
    expect(mapping.event.scriptUsd).toBe(0)
    expect(mapping.event.scenes).toEqual(result.scenes)
    expect(mapping.notionalUsd).toBe(result.notionalUsd)
  }, 120_000)
})
