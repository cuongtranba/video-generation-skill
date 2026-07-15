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

export const DEFAULT_LANGUAGE = 'English'

/** Builds the script prompt in `language` (a freeform name the user picks per
 * project, e.g. "English", "Vietnamese", "Français"). The narration is written
 * in that language so the TTS voice (ElevenLabs multilingual speaks the text's
 * language) and the burned-in captions stay consistent with it. */
export function buildScriptPrompt(input: ScriptInput, language: string = DEFAULT_LANGUAGE): string {
  const lang = language.trim() || DEFAULT_LANGUAGE
  return `Write a vertical short-video script: ${input.durationSec} seconds, exactly ${input.sceneCount} scenes, for the idea: "${input.idea}". Tone: ${input.tone}. Write the spoken narration entirely in ${lang}. Each scene has the narration and a short visual note. Return exactly ${input.sceneCount} scenes, no more and no fewer.`
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

export async function generateScenes(input: ScriptInput, language: string = DEFAULT_LANGUAGE): Promise<ScriptResult> {
  const prompt = buildScriptPrompt(input, language)
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
  async generateScenes(idea: string, durationSec: number, sceneCount: number, tone: string, language: string): Promise<{ scenes: Scene[] }> {
    const result = await generateScenes({ idea, durationSec, sceneCount, tone }, language)
    console.log(`script gen notional cost (observability only, not billed): $${result.notionalUsd}`)
    return { scenes: result.scenes }
  },
}

// P1 placeholder ScriptGenerator, kept for offline/deterministic tests
// (script.test.ts, e2e.integration.test.ts). Production wiring in index.ts
// uses `sdkScriptGenerator` (the real Agent SDK path) instead.
export const stubScriptGenerator: ScriptGenerator = {
  async generateScenes(idea: string, durationSec: number, sceneCount: number, tone: string, language: string): Promise<{ scenes: Scene[] }> {
    const perSceneSec = Math.max(1, Math.round(durationSec / sceneCount))
    const scenes: Scene[] = Array.from({ length: sceneCount }, (_, idx) => ({
      idx,
      narration: `[${tone}/${language}] ${idea} — scene ${idx + 1} of ${sceneCount} (${perSceneSec}s)`,
      visual: `stock footage matching "${idea}"`,
    }))
    return { scenes }
  },
}
