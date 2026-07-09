import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { Database } from './db.js'
import type { CommandContext, CreateProjectInput, PublishInput } from './commands.js'

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requireProjectId(body: Record<string, unknown>): string {
  if (typeof body.projectId !== 'string' || body.projectId.length === 0) {
    throw new HttpError(400, 'projectId:string is required')
  }
  return body.projectId
}

export function parseCreateProjectInput(body: Record<string, unknown>): CreateProjectInput {
  const { idea, durationSec, sceneCount, tone } = body
  if (typeof idea !== 'string' || typeof durationSec !== 'number' || typeof sceneCount !== 'number' || typeof tone !== 'string') {
    throw new HttpError(400, 'CreateProject requires idea:string, durationSec:number, sceneCount:number, tone:string')
  }
  return { idea, durationSec, sceneCount, tone }
}

export function parsePublishInput(body: Record<string, unknown>): PublishInput {
  const projectId = requireProjectId(body)
  const { caption, privacy } = body
  if (typeof caption !== 'string' || typeof privacy !== 'string') {
    throw new HttpError(400, 'Publish requires caption:string, privacy:string')
  }
  return { projectId, caption, privacy }
}

export interface ProjectSummary {
  projectId: string
  idea: string
  status: string
  spentUsd: number
  approved: boolean
  outputPath: string | null
}

export async function listProjects(db: Database): Promise<ProjectSummary[]> {
  const result = await db.query<{
    project_id: string; idea: string; status: string; spent_usd: string; approved: boolean; output_path: string | null
  }>('SELECT project_id, idea, status, spent_usd, approved, output_path FROM projects ORDER BY created_at DESC')
  return result.rows.map((row) => ({
    projectId: row.project_id,
    idea: row.idea,
    status: row.status,
    spentUsd: Number(row.spent_usd),
    approved: row.approved,
    outputPath: row.output_path,
  }))
}

export interface ProjectDetail extends ProjectSummary {
  scenes: Array<{ idx: number; narration: string; visual: string; materialPath: string | null; mp3Path: string | null; assPath: string | null }>
}

export async function getProject(db: Database, projectId: string): Promise<ProjectDetail | null> {
  const projectResult = await db.query<{
    project_id: string; idea: string; status: string; spent_usd: string; approved: boolean; output_path: string | null
  }>('SELECT project_id, idea, status, spent_usd, approved, output_path FROM projects WHERE project_id = $1', [projectId])
  const row = projectResult.rows[0]
  if (!row) return null
  const sceneResult = await db.query<{
    idx: number; narration: string; visual: string; material_path: string | null; mp3_path: string | null; ass_path: string | null
  }>('SELECT idx, narration, visual, material_path, mp3_path, ass_path FROM scenes WHERE project_id = $1 ORDER BY idx ASC', [projectId])
  return {
    projectId: row.project_id,
    idea: row.idea,
    status: row.status,
    spentUsd: Number(row.spent_usd),
    approved: row.approved,
    outputPath: row.output_path,
    scenes: sceneResult.rows.map((s) => ({
      idx: s.idx,
      narration: s.narration,
      visual: s.visual,
      materialPath: s.material_path,
      mp3Path: s.mp3_path,
      assPath: s.ass_path,
    })),
  }
}
