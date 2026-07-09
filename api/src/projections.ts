import type { VidgenEvent } from './events.js'
import type { Database } from './db.js'

export const PROJECTIONS_CONSUMER = 'projections'

export async function applyProjection(db: Database, event: VidgenEvent): Promise<void> {
  switch (event.type) {
    case 'ProjectCreated':
      await db.query(
        `INSERT INTO projects (project_id, idea, duration_sec, scene_count, tone, status, spent_usd, approved, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'draft', 0, FALSE, $6, $6)
         ON CONFLICT (project_id) DO UPDATE SET
           idea = EXCLUDED.idea, duration_sec = EXCLUDED.duration_sec,
           scene_count = EXCLUDED.scene_count, tone = EXCLUDED.tone, updated_at = EXCLUDED.updated_at`,
        [event.projectId, event.idea, event.durationSec, event.sceneCount, event.tone, event.at],
      )
      break
    case 'ScriptGenerated':
      await db.query(`UPDATE projects SET status = 'scripted', updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      for (const scene of event.scenes) {
        await db.query(
          `INSERT INTO scenes (project_id, idx, narration, visual)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, idx) DO UPDATE SET narration = EXCLUDED.narration, visual = EXCLUDED.visual`,
          [event.projectId, scene.idx, scene.narration, scene.visual],
        )
      }
      break
    default:
      break // remaining event types handled in Tasks 17–18
  }
}
