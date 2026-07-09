import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Scene, VidgenEvent } from './events.js'
import type { ScriptGenerator } from './commands.js'

export type ScriptInput = {
  idea: string
  durationSec: number
  sceneCount: number
  tone: string
}

export type ScriptResult = {
  scenes: Scene[]
  notionalUsd: number
}

export type ScriptGeneratedMapping = {
  event: Extract<VidgenEvent, { type: 'ScriptGenerated' }>
  notionalUsd: number
}

export const scriptSchema = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          narration: { type: 'string' },
          visual: { type: 'string' },
        },
        required: ['narration', 'visual'],
      },
    },
  },
  required: ['scenes'],
} as const

export function buildScriptPrompt(input: ScriptInput): string {
  return `Viết kịch bản video dọc ${input.durationSec} giây (${input.sceneCount} cảnh) cho ý tưởng: "${input.idea}". Giọng điệu: ${input.tone}. Mỗi cảnh có lời thoại tiếng Việt (narration) và ghi chú hình ảnh (visual). Trả về đúng ${input.sceneCount} cảnh, không nhiều hơn hoặc ít hơn.`
}

export function parseScenes(structuredOutput: unknown): Scene[] {
  if (typeof structuredOutput !== 'object' || structuredOutput === null) {
    throw new Error(`parseScenes: expected object, got ${typeof structuredOutput}`)
  }
  const raw = structuredOutput as Record<string, unknown>
  const scenesField = raw.scenes
  if (!Array.isArray(scenesField)) {
    throw new Error('parseScenes: expected "scenes" to be an array')
  }
  return scenesField.map((item, idx) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`parseScenes: scene ${idx} is not an object`)
    }
    const { narration, visual } = item as Record<string, unknown>
    if (typeof narration !== 'string' || narration.length === 0) {
      throw new Error(`parseScenes: scene ${idx} missing narration`)
    }
    if (typeof visual !== 'string' || visual.length === 0) {
      throw new Error(`parseScenes: scene ${idx} missing visual`)
    }
    return { idx, narration, visual }
  })
}

export function mapScriptGeneratedEvent(projectId: string, at: string, result: ScriptResult): ScriptGeneratedMapping {
  return {
    event: { v: 1, type: 'ScriptGenerated', projectId, at, scenes: result.scenes, scriptUsd: 0 },
    notionalUsd: result.notionalUsd,
  }
}

export async function generateScenes(input: ScriptInput): Promise<ScriptResult> {
  const prompt = buildScriptPrompt(input)
  let result: ScriptResult | undefined

  for await (const message of query({
    prompt,
    options: { outputFormat: { type: 'json_schema', schema: scriptSchema } },
  })) {
    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error(`generateScenes: SDK query failed (${message.subtype}): ${message.errors.join('; ')}`)
      }
      const scenes = parseScenes(message.structured_output)
      result = { scenes, notionalUsd: message.total_cost_usd }
    }
  }

  if (!result) {
    throw new Error('generateScenes: SDK query produced no result message')
  }
  return result
}

/** Adapter: bridges the SDK-backed `generateScenes(ScriptInput)` to P1's
 * frozen `ScriptGenerator` interface (positional args, `{ scenes }` return).
 * `index.ts` wires this in production. `notionalUsd` is logged for
 * observability only — per the D1 BINDING rule it never enters the event or
 * the enforced cost ledger (scriptUsd stays 0). */
export const sdkScriptGenerator: ScriptGenerator = {
  async generateScenes(idea: string, durationSec: number, sceneCount: number, tone: string): Promise<{ scenes: Scene[] }> {
    const result = await generateScenes({ idea, durationSec, sceneCount, tone })
    console.log(`script gen notional cost (observability only, not billed): $${result.notionalUsd}`)
    return { scenes: result.scenes }
  },
}

// P1 placeholder ScriptGenerator, kept for offline/deterministic tests
// (script.test.ts, e2e.integration.test.ts). Production wiring in index.ts
// uses `sdkScriptGenerator` (the real Agent SDK path) instead.
export const stubScriptGenerator: ScriptGenerator = {
  async generateScenes(idea: string, durationSec: number, sceneCount: number, tone: string): Promise<{ scenes: Scene[] }> {
    const perSceneSec = Math.max(1, Math.round(durationSec / sceneCount))
    const scenes: Scene[] = Array.from({ length: sceneCount }, (_, idx) => ({
      idx,
      narration: `[${tone}] ${idea} — scene ${idx + 1} of ${sceneCount} (${perSceneSec}s)`,
      visual: `stock footage matching "${idea}"`,
    }))
    return { scenes }
  },
}
