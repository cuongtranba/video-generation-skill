import type { Scene } from './events.js'
import type { ScriptGenerator } from './commands.js'

// P1 placeholder ScriptGenerator. The real Claude Agent SDK integration is
// built in docs/superpowers/plans/2026-07-09-vidgen-webapp-02-agent-sdk-script.md
// (P2) and overwrites this file's export in index.ts's wiring. Kept in its
// own file (not commands.ts) so P2 can replace it without touching P1 code.
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
