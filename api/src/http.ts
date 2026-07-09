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

import type {
  ResolveMaterialInput, GenerateVoiceoversInput, RequestApprovalInput, ApproveStoryboardInput, GenerateScriptInput,
} from './commands.js'
import * as commands from './commands.js'

export interface HttpConfig {
  db: Database
  ctx: CommandContext
  spaDir: string
  mediaDir: string
}

type CommandHandler = (ctx: CommandContext, body: Record<string, unknown>) => Promise<unknown>

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  CreateProject: (ctx, body) => commands.createProject(ctx, parseCreateProjectInput(body)),
  GenerateScript: (ctx, body) => commands.generateScript(ctx, { projectId: requireProjectId(body) } satisfies GenerateScriptInput),
  ResolveMaterial: (ctx, body) => commands.resolveMaterial(ctx, { projectId: requireProjectId(body) } satisfies ResolveMaterialInput),
  GenerateVoiceovers: (ctx, body) => commands.generateVoiceovers(ctx, { projectId: requireProjectId(body) } satisfies GenerateVoiceoversInput),
  RequestApproval: (ctx, body) => commands.requestApproval(ctx, { projectId: requireProjectId(body) } satisfies RequestApprovalInput),
  ApproveStoryboard: (ctx, body) => commands.approveStoryboard(ctx, { projectId: requireProjectId(body) } satisfies ApproveStoryboardInput),
  Publish: (ctx, body) => commands.publish(ctx, parsePublishInput(body)),
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  const parsed: unknown = JSON.parse(raw)
  if (!isPlainObject(parsed)) {
    throw new HttpError(400, 'request body must be a JSON object')
  }
  return parsed
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Best-effort, per-process cache: guards against re-running a command
 * handler for a retried idempotencyKey within one api process's lifetime.
 * True cross-restart dedup comes from the NATS 2-minute dupe window on the
 * deterministic event msgID (index.md §4) — this cache just avoids paying
 * for (e.g.) a second script-generation call on a client retry. */
const idempotencyCache = new Map<string, unknown>()

async function handleCommand(config: HttpConfig, name: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const handler = COMMAND_HANDLERS[name]
  if (!handler) {
    sendJson(res, 404, { error: `unknown command ${name}` })
    return
  }
  const body = await readJsonBody(req)
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined
  const cacheKey = idempotencyKey ? `${name}:${idempotencyKey}` : undefined
  if (cacheKey && idempotencyCache.has(cacheKey)) {
    sendJson(res, 200, idempotencyCache.get(cacheKey))
    return
  }
  const result = await handler(config.ctx, body)
  if (cacheKey) idempotencyCache.set(cacheKey, result)
  sendJson(res, 200, result)
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
}

async function serveStatic(rootDir: string, urlPath: string, res: ServerResponse, fallbackToIndex: boolean): Promise<void> {
  const safeSuffix = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
  let filePath = path.join(rootDir, safeSuffix)
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html')
    await stat(filePath)
  } catch {
    if (!fallbackToIndex) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    filePath = path.join(rootDir, 'index.html')
  }
  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' })
  createReadStream(filePath).pipe(res)
}

async function routeRequest(config: HttpConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (req.method === 'POST' && url.pathname.startsWith('/api/commands/')) {
      await handleCommand(config, url.pathname.slice('/api/commands/'.length), req, res)
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, { projects: await listProjects(config.db) })
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/projects/')) {
      const projectId = url.pathname.slice('/api/projects/'.length)
      const project = await getProject(config.db, projectId)
      if (!project) {
        sendJson(res, 404, { error: `project ${projectId} not found` })
        return
      }
      sendJson(res, 200, project)
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      await serveStatic(config.mediaDir, url.pathname.slice('/media/'.length), res, false)
      return
    }
    if (req.method === 'GET') {
      await serveStatic(config.spaDir, url.pathname, res, true)
      return
    }
    sendJson(res, 405, { error: 'method not allowed' })
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message })
      return
    }
    console.error('http handler error:', err)
    sendJson(res, 500, { error: 'internal error' })
  }
}

export function createHttpServer(config: HttpConfig) {
  return createServer((req, res) => {
    void routeRequest(config, req, res)
  })
}
