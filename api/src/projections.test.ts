import { describe, it, expect } from 'bun:test'
import { applyProjection } from './projections.js'
import type { Database } from './db.js'
import type { VidgenEvent } from './events.js'

type Call = { sql: string; params: unknown[] }

/** Minimal fake Pool: records every query. applyProjection only calls
 * db.query, so a capturing stub is enough to assert the fold's SQL + params
 * without a live Postgres. */
function fakeDb(): { db: Database; calls: Call[] } {
  const calls: Call[] = []
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] })
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
  return { db, calls }
}

describe('applyProjection StyleSet', () => {
  it('folds StyleSet into a single projects.style UPDATE with serialized style', async () => {
    const { db, calls } = fakeDb()
    const event: VidgenEvent = {
      v: 1,
      type: 'StyleSet',
      projectId: 'p1',
      at: '2026-07-10T00:00:00.000Z',
      uid: 'u1',
      voice: 'lannhi',
      speed: 1,
      captionStyle: { fontName: 'Roboto', fontSize: 72 },
      music: { search: 'lofi', volume: 0.3 },
    }

    await applyProjection(db, event)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.sql).toBe('UPDATE projects SET style = $2, updated_at = $3 WHERE project_id = $1')
    expect(calls[0]!.params[0]).toBe('p1')
    expect(calls[0]!.params[2]).toBe('2026-07-10T00:00:00.000Z')
    expect(JSON.parse(calls[0]!.params[1] as string)).toEqual({
      voice: 'lannhi',
      speed: 1,
      captionStyle: { fontName: 'Roboto', fontSize: 72 },
      music: { search: 'lofi', volume: 0.3 },
    })
  })

  it('serializes null music', async () => {
    const { db, calls } = fakeDb()
    const event: VidgenEvent = {
      v: 1,
      type: 'StyleSet',
      projectId: 'p2',
      at: '2026-07-10T00:00:00.000Z',
      uid: 'u2',
      voice: 'banmai',
      speed: 0,
      captionStyle: { fontName: 'Arial', fontSize: 64 },
      music: null,
    }

    await applyProjection(db, event)

    expect(JSON.parse(calls[0]!.params[1] as string).music).toBeNull()
  })
})
