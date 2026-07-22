import path from 'node:path'
import type { Database } from './db.js'
import { dispatchJob, type Publisher } from './nats.js'
import { DEFAULT_STYLE, type StyleSpec, type VidgenEvent } from './events.js'

/** Reacts to newly-folded events with follow-up job dispatch. This is the
 * write-side policy layer, kept OUT of applyProjection (which stays a pure
 * read-model fold and is replayed wholesale by rebuildProjections). It runs
 * only on the live projections consume path.
 *
 * Today it owns one policy: dispatch the project's single caption job once
 * every scene has a voiceover. The caption job reads the per-scene
 * `tts{idx}.words.json` sidecars the tts step writes; dispatching it eagerly
 * alongside the tts jobs raced those writes and failed the run, so we wait for
 * all VoiceSynthesized events (each emitted only after its sidecar is on disk)
 * before dispatching. */
export async function reactToEvent(js: Publisher, db: Database, mediaDir: string, event: VidgenEvent): Promise<void> {
  if (event.type === 'VoiceSynthesized') {
    await maybeDispatchCaption(js, db, mediaDir, event.projectId)
  }
}

type SceneRow = { idx: number; narration: string; mp3_path: string | null; ass_path: string | null }
type ProjectRow = { scene_count: number; style: unknown }

async function maybeDispatchCaption(js: Publisher, db: Database, mediaDir: string, projectId: string): Promise<void> {
  const projectResult = await db.query<ProjectRow>('SELECT scene_count, style FROM projects WHERE project_id = $1', [projectId])
  const project = projectResult.rows[0]
  if (!project) return

  const sceneResult = await db.query<SceneRow>(
    'SELECT idx, narration, mp3_path, ass_path FROM scenes WHERE project_id = $1 ORDER BY idx ASC',
    [projectId],
  )
  const scenes = sceneResult.rows

  // Gate: every scene present and voiced, and captions not already built (the
  // CaptionsBuilt fold sets ass_path). The ass_path check also makes a backlog
  // replay of an already-captioned project a no-op.
  const allVoiced = scenes.length === project.scene_count && scenes.length > 0 && scenes.every((s) => s.mp3_path)
  const alreadyCaptioned = scenes.some((s) => s.ass_path)
  if (!allVoiced || alreadyCaptioned) return

  const captionStyle = parseCaptionStyle(project.style)
  const projectMediaDir = path.join(mediaDir, projectId)
  // sceneIdx=null → JetStream msgID "caption-<project>--" dedups a double
  // dispatch (e.g. two VoiceSynthesized landing near-simultaneously) to one job.
  await dispatchJob(js, 'caption', projectId, null, {
    sceneAudio: scenes.map((s) => ({
      audioPath: path.join(projectMediaDir, `tts${s.idx}.mp3`),
      startOffsetSec: 0,
      narration: s.narration,
    })),
    style: {
      font_name: captionStyle.fontName,
      font_size: captionStyle.fontSize,
      primary: '#FFFFFF',
      outline: '#000000',
      bold: true,
    },
    destPath: path.join(projectMediaDir, 'captions.ass'),
  })
}

/** The projects.style column stores a serialized StyleSpec (or null before any
 * StyleSet). Narrow it to the caption style, falling back to the default. */
function parseCaptionStyle(style: unknown): StyleSpec['captionStyle'] {
  if (style && typeof style === 'object') {
    const cs = (style as { captionStyle?: unknown }).captionStyle
    if (cs && typeof cs === 'object') {
      const { fontName, fontSize } = cs as { fontName?: unknown; fontSize?: unknown }
      if (typeof fontName === 'string' && typeof fontSize === 'number') {
        return { fontName, fontSize }
      }
    }
  }
  return { ...DEFAULT_STYLE.captionStyle }
}
