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
    case 'AwaitingApproval':
      await db.query(`UPDATE projects SET status = 'awaiting_approval', updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      break
    case 'ApprovalGranted':
      await db.query(`UPDATE projects SET status = 'approved', approved = TRUE, updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      break
    case 'RenderCompleted':
      await db.query(
        `UPDATE projects SET status = 'rendered', output_path = $2, updated_at = $3 WHERE project_id = $1`,
        [event.projectId, event.outputPath, event.at],
      )
      await db.query(
        `INSERT INTO assets (project_id, scene_idx, kind, path, created_at)
         VALUES ($1, NULL, 'render', $2, $3)
         ON CONFLICT (project_id, kind, (COALESCE(scene_idx, -1)))
         DO UPDATE SET path = EXCLUDED.path, created_at = EXCLUDED.created_at`,
        [event.projectId, event.outputPath, event.at],
      )
      await db.query(
        `INSERT INTO cost_ledger (project_id, event_type, scene_idx, amount_usd, at)
         VALUES ($1, 'RenderCompleted', NULL, $2, $3)
         ON CONFLICT (project_id, event_type, (COALESCE(scene_idx, -1)))
         DO UPDATE SET amount_usd = EXCLUDED.amount_usd, at = EXCLUDED.at`,
        [event.projectId, event.renderUsd, event.at],
      )
      await recomputeSpentUsd(db, event.projectId)
      break
    case 'Published':
      await db.query(`UPDATE projects SET status = 'published', updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      break
    case 'RunFailed':
      await db.query(`UPDATE projects SET status = 'failed', updated_at = $2 WHERE project_id = $1`, [event.projectId, event.at])
      break
  }
}

async function recomputeSpentUsd(db: Database, projectId: string): Promise<void> {
  await db.query(
    `UPDATE projects SET spent_usd = COALESCE((SELECT SUM(amount_usd) FROM cost_ledger WHERE project_id = $1), 0) WHERE project_id = $1`,
    [projectId],
  )
}

import type { JetStreamClient, JetStreamManager } from '@nats-io/jetstream'
import { EVENTS_STREAM, ensureDurableConsumer, deleteDurableConsumer, consumeEvents } from './nats.js'

/** Long-running: wires the durable "projections" consumer to fold every new
 * VIDGEN_EVENTS message into Postgres. Backlog is delivered first (durable
 * consumers with DeliverPolicy.All start at the beginning on first
 * creation), then live events as they arrive. Never resolves in normal
 * operation — callers run it as a background task. */
export async function runProjections(js: JetStreamClient, jsm: JetStreamManager, db: Database): Promise<void> {
  await ensureDurableConsumer(jsm, PROJECTIONS_CONSUMER)
  await consumeEvents(js, PROJECTIONS_CONSUMER, (event) => applyProjection(db, event))
}

/** Postgres is disposable (spec §2.5): wipe the read-model tables, drop the
 * durable consumer's ack floor by deleting and recreating it, then
 * synchronously fetch every stored event from stream seq 0 and re-fold it.
 * Bounded (returns once a fetch comes back empty), unlike runProjections. */
export async function rebuildProjections(js: JetStreamClient, jsm: JetStreamManager, db: Database): Promise<void> {
  await db.query('TRUNCATE cost_ledger, assets, scenes, projects RESTART IDENTITY CASCADE')
  await deleteDurableConsumer(jsm, PROJECTIONS_CONSUMER)
  await ensureDurableConsumer(jsm, PROJECTIONS_CONSUMER)
  const consumer = await js.consumers.get(EVENTS_STREAM, PROJECTIONS_CONSUMER)
  for (;;) {
    const batch = await consumer.fetch({ max_messages: 1000, expires: 1000 }) // @nats-io/jetstream@3.4.0 requires expires >= 1000ms
    let count = 0
    for await (const m of batch) {
      const event = m.json<VidgenEvent>()
      await applyProjection(db, event)
      m.ack()
      count++
    }
    if (count === 0) break
  }
}
