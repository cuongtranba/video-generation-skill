import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat, mkdir, writeFile, readdir, stat as fsStat } from 'node:fs/promises'
import path from 'node:path'
import type { Database } from './db.js'
import type { CommandContext, CreateProjectInput, PublishInput } from './commands.js'
import type { StyleSpec } from './events.js'

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Rejects projectId values that could escape the mediaDir via path traversal.
 * A single '.' or '..' component, or any value containing a path separator,
 * is refused with a 400 HttpError. */
export function guardProjectId(projectId: string): void {
  if (projectId === '.' || projectId === '..' || projectId.includes('/') || projectId.includes('\\')) {
    throw new HttpError(400, 'invalid projectId')
  }
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
  style: StyleSpec | null
  scenes: Array<{ idx: number; narration: string; visual: string; materialPath: string | null; mp3Path: string | null; assPath: string | null }>
}

export async function getProject(db: Database, projectId: string): Promise<ProjectDetail | null> {
  const projectResult = await db.query<{
    project_id: string; idea: string; status: string; spent_usd: string; approved: boolean; output_path: string | null; style: unknown
  }>('SELECT project_id, idea, status, spent_usd, approved, output_path, style FROM projects WHERE project_id = $1', [projectId])
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
    style: (row.style ?? null) as StyleSpec | null,
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
  GenerateVoiceoversInput, RequestApprovalInput, ApproveStoryboardInput, GenerateScriptInput,
  TuneInput,
} from './commands.js'
import * as commands from './commands.js'
import { ValidationError } from './aggregate.js'

export function parseTuneInput(body: Record<string, unknown>): TuneInput {
  const projectId = requireProjectId(body)
  const input: TuneInput = { projectId }
  if ('voice' in body) {
    if (typeof body.voice !== 'string') throw new HttpError(400, 'voice must be a string')
    input.voice = body.voice
  }
  if ('speed' in body) {
    if (typeof body.speed !== 'number') throw new HttpError(400, 'speed must be a number')
    input.speed = body.speed
  }
  if ('captionStyle' in body) {
    const cs = body.captionStyle
    if (typeof cs !== 'object' || cs === null || Array.isArray(cs)) throw new HttpError(400, 'captionStyle must be an object')
    const { fontName, fontSize } = cs as Record<string, unknown>
    if (typeof fontName !== 'string' || typeof fontSize !== 'number') throw new HttpError(400, 'captionStyle requires fontName:string, fontSize:number')
    input.captionStyle = { fontName, fontSize }
  }
  if ('music' in body) {
    if (body.music === null) {
      input.music = null
    } else {
      const m = body.music
      if (typeof m !== 'object' || m === null || Array.isArray(m)) throw new HttpError(400, 'music must be an object or null')
      const { search, volume } = m as Record<string, unknown>
      if (typeof search !== 'string' || typeof volume !== 'number') throw new HttpError(400, 'music requires search:string, volume:number')
      input.music = { search, volume }
    }
  }
  return input
}

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
  ResolveMaterial: async (ctx, body) => {
    const projectId = requireProjectId(body)
    guardProjectId(projectId)
    const assetsDir = path.join(ctx.mediaDir, projectId, 'assets')
    let uploadedPaths: string[] = []
    try {
      const names = (await readdir(assetsDir)).sort()
      uploadedPaths = names.map((n) => path.join(assetsDir, n))
    } catch {
      // no assets uploaded — all scenes fall back to stock
    }
    return commands.resolveMaterialWithAssets(ctx, { projectId }, uploadedPaths)
  },
  GenerateVoiceovers: (ctx, body) => commands.generateVoiceovers(ctx, { projectId: requireProjectId(body) } satisfies GenerateVoiceoversInput),
  RequestApproval: (ctx, body) => commands.requestApproval(ctx, { projectId: requireProjectId(body) } satisfies RequestApprovalInput),
  ApproveStoryboard: (ctx, body) => commands.approveStoryboard(ctx, { projectId: requireProjectId(body) } satisfies ApproveStoryboardInput),
  TuneProject: (ctx, body) => commands.tuneProject(ctx, parseTuneInput(body)),
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
    // Re-stat the SPA fallback: if it too is absent (e.g. P1 ships no public/
    // dir yet), 404 instead of piping a nonexistent file — an unhandled
    // ReadStream 'error' would otherwise crash the whole api process.
    filePath = path.join(rootDir, 'index.html')
    try {
      await stat(filePath)
    } catch {
      sendJson(res, 404, { error: 'not found' })
      return
    }
  }
  const ext = path.extname(filePath)
  const stream = createReadStream(filePath)
  // Guard against a file vanishing between stat and read: never let an
  // unhandled stream error take the process down.
  stream.once('error', (err) => {
    console.error('static stream error:', err)
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' })
    else res.destroy()
  })
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' })
  stream.pipe(res)
}

const ALLOWED_UPLOAD_EXTS = new Set(['.mp4', '.mov', '.jpg', '.jpeg', '.png'])
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100 MB

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_')
}

async function handleUploadAsset(config: HttpConfig, projectId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length
    if (total > MAX_UPLOAD_BYTES) {
      sendJson(res, 413, { error: 'file too large (max 100 MB)' })
      return
    }
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks)
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    sendJson(res, 400, { error: 'expected multipart/form-data' })
    return
  }

  // Parse multipart using the Web Request API (Bun-native).
  const request = new Request('http://localhost/upload', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  })
  const formData = await request.formData().catch(() => null)
  if (formData === null) {
    sendJson(res, 400, { error: 'invalid multipart body' })
    return
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    sendJson(res, 400, { error: 'multipart field "file" is required' })
    return
  }

  const ext = path.extname(file.name).toLowerCase()
  if (!ALLOWED_UPLOAD_EXTS.has(ext)) {
    sendJson(res, 400, { error: `file type ${ext} not allowed; use: ${[...ALLOWED_UPLOAD_EXTS].join(', ')}` })
    return
  }

  const safeName = sanitizeFilename(file.name)
  const assetsDir = path.join(config.mediaDir, projectId, 'assets')
  await mkdir(assetsDir, { recursive: true })
  const destPath = path.join(assetsDir, safeName)
  const bytes = await file.arrayBuffer()
  await writeFile(destPath, Buffer.from(bytes))

  sendJson(res, 200, { filename: safeName, path: destPath, sizeBytes: file.size })
}

async function handleListAssets(config: HttpConfig, projectId: string, res: ServerResponse): Promise<void> {
  const assetsDir = path.join(config.mediaDir, projectId, 'assets')
  try {
    const names = await readdir(assetsDir)
    const items = await Promise.all(
      names.map(async (name) => {
        const info = await fsStat(path.join(assetsDir, name))
        return { filename: name, sizeBytes: info.size }
      }),
    )
    sendJson(res, 200, { assets: items })
  } catch {
    sendJson(res, 200, { assets: [] })
  }
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
    if (req.method === 'POST' && url.pathname.match(/^\/api\/projects\/[^/]+\/assets$/)) {
      const projectId = url.pathname.split('/')[3]!
      guardProjectId(projectId)
      await handleUploadAsset(config, projectId, req, res)
      return
    }
    if (req.method === 'GET' && url.pathname.match(/^\/api\/projects\/[^/]+\/assets$/)) {
      const projectId = url.pathname.split('/')[3]!
      guardProjectId(projectId)
      await handleListAssets(config, projectId, res)
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
    if (err instanceof ValidationError) {
      sendJson(res, 400, { error: err.message })
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
