import { describe, it, expect } from 'bun:test'
import type { Database } from './db.js'
import type { Publisher } from './nats.js'
import type { VidgenEvent } from './events.js'
import { reactToEvent } from './reactions.js'

type SceneRow = { idx: number; narration: string; mp3_path: string | null; ass_path: string | null }
type ProjectRow = { scene_count: number; style: unknown }

/** Fake Pool: returns canned project/scene rows by matching the query text.
 * reactToEvent only reads (projects, scenes); no writes. */
function fakeDb(project: ProjectRow | null, scenes: SceneRow[]): Database {
  return {
    query: async (sql: string) => {
      if (sql.includes('FROM projects')) {
        return { rows: project ? [project] : [], rowCount: project ? 1 : 0 }
      }
      if (sql.includes('FROM scenes')) {
        return { rows: scenes, rowCount: scenes.length }
      }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
}

function fakePublisher(): Publisher & { published: Array<{ subject: string; data: string; msgID?: string }> } {
  const published: Array<{ subject: string; data: string; msgID?: string }> = []
  return {
    published,
    async publish(subject: string, data: string | Uint8Array, opts?: { msgID?: string }) {
      published.push({ subject, data: typeof data === 'string' ? data : new TextDecoder().decode(data), msgID: opts?.msgID })
      return { seq: published.length, duplicate: false, stream: 'VIDGEN_JOBS' } as never
    },
  } as unknown as Publisher & { published: Array<{ subject: string; data: string; msgID?: string }> }
}

function voiceSynthesized(projectId: string, sceneIdx: number): VidgenEvent {
  return { v: 1, type: 'VoiceSynthesized', projectId, at: '2026-07-22T00:00:00.000Z', sceneIdx, mp3Path: `tts${sceneIdx}.mp3`, durationSec: 3, ttsUsd: 0.01 }
}

describe('reactToEvent — caption dispatch after all voiceovers', () => {
  it('dispatches the caption job once when the final voiceover completes all scenes', async () => {
    const db = fakeDb(
      { scene_count: 2, style: null },
      [
        { idx: 0, narration: 'Xin chào', mp3_path: 'tts0.mp3', ass_path: null },
        { idx: 1, narration: 'Tạm biệt', mp3_path: 'tts1.mp3', ass_path: null },
      ],
    )
    const js = fakePublisher()
    await reactToEvent(js, db, '/media', voiceSynthesized('p1', 1))

    expect(js.published).toHaveLength(1)
    const msg = js.published[0]!
    expect(msg.subject).toBe('vidgen.job.caption.p1.-')
    expect(msg.msgID).toBe('caption-p1--')
    const body = JSON.parse(msg.data) as {
      projectId: string
      sceneIdx: number | null
      sceneAudio: Array<{ audioPath: string; startOffsetSec: number; narration: string }>
      style: { font_name: string; font_size: number; primary: string; outline: string; bold: boolean }
      destPath: string
    }
    expect(body.projectId).toBe('p1')
    expect(body.sceneIdx).toBeNull()
    expect(body.destPath).toBe('/media/p1/captions.ass')
    expect(body.sceneAudio).toEqual([
      { audioPath: '/media/p1/tts0.mp3', startOffsetSec: 0, narration: 'Xin chào' },
      { audioPath: '/media/p1/tts1.mp3', startOffsetSec: 0, narration: 'Tạm biệt' },
    ])
    // Default caption style is applied when the project has no StyleSet.
    expect(body.style.font_name).toBe('Arial')
    expect(body.style.font_size).toBe(64)
    expect(body.style.bold).toBe(true)
  })

  it('does NOT dispatch when some scenes still lack a voiceover', async () => {
    const db = fakeDb(
      { scene_count: 2, style: null },
      [
        { idx: 0, narration: 'Xin chào', mp3_path: 'tts0.mp3', ass_path: null },
        { idx: 1, narration: 'Tạm biệt', mp3_path: null, ass_path: null },
      ],
    )
    const js = fakePublisher()
    await reactToEvent(js, db, '/media', voiceSynthesized('p1', 0))
    expect(js.published).toHaveLength(0)
  })

  it('does NOT re-dispatch when captions were already built (ass_path present)', async () => {
    const db = fakeDb(
      { scene_count: 2, style: null },
      [
        { idx: 0, narration: 'Xin chào', mp3_path: 'tts0.mp3', ass_path: 'captions.ass' },
        { idx: 1, narration: 'Tạm biệt', mp3_path: 'tts1.mp3', ass_path: null },
      ],
    )
    const js = fakePublisher()
    await reactToEvent(js, db, '/media', voiceSynthesized('p1', 1))
    expect(js.published).toHaveLength(0)
  })

  it('applies the project StyleSet caption style when present', async () => {
    const db = fakeDb(
      { scene_count: 1, style: { voice: 'lannhi', speed: 0, captionStyle: { fontName: 'Roboto', fontSize: 72 }, music: null } },
      [{ idx: 0, narration: 'Một', mp3_path: 'tts0.mp3', ass_path: null }],
    )
    const js = fakePublisher()
    await reactToEvent(js, db, '/media', voiceSynthesized('p1', 0))
    expect(js.published).toHaveLength(1)
    const body = JSON.parse(js.published[0]!.data) as { style: { font_name: string; font_size: number } }
    expect(body.style.font_name).toBe('Roboto')
    expect(body.style.font_size).toBe(72)
  })

  it('ignores non-VoiceSynthesized events', async () => {
    const db = fakeDb({ scene_count: 1, style: null }, [{ idx: 0, narration: 'Một', mp3_path: 'tts0.mp3', ass_path: null }])
    const js = fakePublisher()
    await reactToEvent(js, db, '/media', { v: 1, type: 'MaterialResolved', projectId: 'p1', at: '2026-07-22T00:00:00.000Z', sceneIdx: 0, source: 'pexels', assetPath: 'm0.mp4' })
    expect(js.published).toHaveLength(0)
  })
})
