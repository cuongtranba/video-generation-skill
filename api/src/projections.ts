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
    case 'MaterialResolved':
      await db.query(`UPDATE projects SET status = 'material', updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      await db.query(
        `UPDATE scenes SET material_source = $3, material_path = $4 WHERE project_id = $1 AND idx = $2`,
        [event.projectId, event.sceneIdx, event.source, event.assetPath],
      )
      await db.query(
        `INSERT INTO assets (project_id, scene_idx, kind, path, created_at)
         VALUES ($1, $2, 'material', $3, $4)
         ON CONFLICT (project_id, kind, (COALESCE(scene_idx, -1)))
         DO UPDATE SET path = EXCLUDED.path, created_at = EXCLUDED.created_at`,
        [event.projectId, event.sceneIdx, event.assetPath, event.at],
      )
      break
    case 'VoiceSynthesized':
      await db.query(`UPDATE scenes SET mp3_path = $3, tts_usd = $4 WHERE project_id = $1 AND idx = $2`, [
        event.projectId, event.sceneIdx, event.mp3Path, event.ttsUsd,
      ])
      await db.query(
        `INSERT INTO assets (project_id, scene_idx, kind, path, created_at)
         VALUES ($1, $2, 'voice', $3, $4)
         ON CONFLICT (project_id, kind, (COALESCE(scene_idx, -1)))
         DO UPDATE SET path = EXCLUDED.path, created_at = EXCLUDED.created_at`,
        [event.projectId, event.sceneIdx, event.mp3Path, event.at],
      )
      await db.query(
        `INSERT INTO cost_ledger (project_id, event_type, scene_idx, amount_usd, at)
         VALUES ($1, 'VoiceSynthesized', $2, $3, $4)
         ON CONFLICT (project_id, event_type, (COALESCE(scene_idx, -1)))
         DO UPDATE SET amount_usd = EXCLUDED.amount_usd, at = EXCLUDED.at`,
        [event.projectId, event.sceneIdx, event.ttsUsd, event.at],
      )
      await recomputeSpentUsd(db, event.projectId)
      break
    case 'CaptionsBuilt':
      await db.query(`UPDATE scenes SET ass_path = $3 WHERE project_id = $1 AND idx = $2`, [event.projectId, event.sceneIdx, event.assPath])
      await db.query(
        `INSERT INTO assets (project_id, scene_idx, kind, path, created_at)
         VALUES ($1, $2, 'caption', $3, $4)
         ON CONFLICT (project_id, kind, (COALESCE(scene_idx, -1)))
         DO UPDATE SET path = EXCLUDED.path, created_at = EXCLUDED.created_at`,
        [event.projectId, event.sceneIdx, event.assPath, event.at],
      )
      break
    case 'CostProjected':
      // Observability only — projected cost is not part of the enforced
      // ledger total (index.md §6: enforced total = Σ ttsUsd + renderUsd).
      break
    default:
      break // remaining event types handled in Task 18
  }
}

async function recomputeSpentUsd(db: Database, projectId: string): Promise<void> {
  await db.query(
    `UPDATE projects SET spent_usd = COALESCE((SELECT SUM(amount_usd) FROM cost_ledger WHERE project_id = $1), 0) WHERE project_id = $1`,
    [projectId],
  )
}
