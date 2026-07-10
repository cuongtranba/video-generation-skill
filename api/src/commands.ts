import { randomUUID } from 'node:crypto'
import type { Scene, VidgenEvent, ProjectState } from './events.js'
import { foldProject } from './events.js'
import { assertCanCreate, assertExists, assertTransition, ValidationError } from './aggregate.js'
import type { EventStore, Publisher } from './nats.js'
import { publishEvent, dispatchJob } from './nats.js'
import { admit, costCapFromEnv, projectedTtsUsd, CostCapExceededError } from './cost.js'

export type { EventStore } from './nats.js'

/** Authored fully in P2 (docs/superpowers/plans/2026-07-09-vidgen-webapp-02-agent-sdk-script.md).
 * P1 depends only on this interface and injects a stub for its own tests. */
export interface ScriptGenerator {
  generateScenes(idea: string, durationSec: number, sceneCount: number, tone: string): Promise<{ scenes: Scene[] }>
}

export interface CreateProjectInput { idea: string; durationSec: number; sceneCount: number; tone: string }
export interface GenerateScriptInput { projectId: string }
export interface ResolveMaterialInput { projectId: string }
export interface GenerateVoiceoversInput { projectId: string }
export interface RequestApprovalInput { projectId: string }
export interface ApproveStoryboardInput { projectId: string }
export interface PublishInput { projectId: string; caption: string; privacy: string }

export interface TuneInput {
  projectId: string
  voice?: string
  speed?: number
  captionStyle?: { fontName: string; fontSize: number }
  music?: { search: string; volume: number } | null
}

export interface CommandContext {
  store: EventStore
  js: Publisher
  scriptGen: ScriptGenerator
  now: () => string
  costCapUsd: number
  /** Root dir for per-project media assets. Consumed by later tasks; carried
   * on the context now so the tune/material/render commands share one source. */
  mediaDir: string
}

export function createCommandContext(
  store: EventStore,
  js: Publisher,
  scriptGen: ScriptGenerator,
  costCapUsd: number = costCapFromEnv(),
  mediaDir: string = 'media',
): CommandContext {
  return { store, js, scriptGen, now: () => new Date().toISOString(), costCapUsd, mediaDir }
}

/** Valid FPT.AI voice identifiers — mirrors worker/internal/domain project voices. */
const VALID_VOICES = ['banmai', 'thuminh', 'lannhi', 'linhsan', 'leminh', 'giahuy', 'myan']

export async function createProject(ctx: CommandContext, input: CreateProjectInput): Promise<{ projectId: string }> {
  const projectId = randomUUID()
  const events = await ctx.store.loadEvents(projectId)
  assertCanCreate(events, projectId)
  const event: VidgenEvent = {
    v: 1,
    type: 'ProjectCreated',
    projectId,
    at: ctx.now(),
    idea: input.idea,
    durationSec: input.durationSec,
    sceneCount: input.sceneCount,
    tone: input.tone,
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return { projectId }
}

export async function generateScript(ctx: CommandContext, input: GenerateScriptInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('GenerateScript', state)
  const created = events.find((e): e is Extract<VidgenEvent, { type: 'ProjectCreated' }> => e.type === 'ProjectCreated')
  if (!created) throw new Error(`project ${input.projectId} missing ProjectCreated event`)
  const { scenes } = await ctx.scriptGen.generateScenes(created.idea, created.durationSec, created.sceneCount, created.tone)
  const event: VidgenEvent = {
    v: 1,
    type: 'ScriptGenerated',
    projectId: input.projectId,
    at: ctx.now(),
    scenes,
    scriptUsd: 0, // BINDING (index.md §6): Agent SDK notional cost is never enforced
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return foldProject([...events, event])
}

export async function tuneProject(ctx: CommandContext, input: TuneInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('TuneProject', state)

  if (input.voice !== undefined && !VALID_VOICES.includes(input.voice)) {
    throw new ValidationError(`voice must be one of: ${VALID_VOICES.join(', ')}`)
  }
  if (input.speed !== undefined && (!Number.isInteger(input.speed) || input.speed < -3 || input.speed > 3)) {
    throw new ValidationError('speed must be an integer in range -3..3')
  }
  if (input.music != null && (input.music.volume <= 0 || input.music.volume > 1)) {
    throw new ValidationError('music.volume must be in range (0, 1]')
  }

  const cur = state.style
  // 'music' key present (even null) means explicit set/clear; absent means keep current.
  const music = 'music' in input ? (input.music ?? null) : cur.music

  const event: VidgenEvent = {
    v: 1,
    type: 'StyleSet',
    projectId: input.projectId,
    at: ctx.now(),
    uid: randomUUID(),
    voice: input.voice ?? cur.voice,
    speed: input.speed ?? cur.speed,
    captionStyle: input.captionStyle ?? cur.captionStyle,
    music,
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return foldProject([...events, event])
}

export async function requestApproval(ctx: CommandContext, input: RequestApprovalInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('RequestApproval', state)
  const event: VidgenEvent = { v: 1, type: 'AwaitingApproval', projectId: input.projectId, at: ctx.now() }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return foldProject([...events, event])
}

export async function approveStoryboard(ctx: CommandContext, input: ApproveStoryboardInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('ApproveStoryboard', state)
  const event: VidgenEvent = { v: 1, type: 'ApprovalGranted', projectId: input.projectId, at: ctx.now() }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  await dispatchJob(ctx.js, 'render', input.projectId, null, {})
  return foldProject([...events, event])
}

export async function publish(ctx: CommandContext, input: PublishInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('Publish', state)
  // P1 stub: the real TikTok publish call is a Go worker concern (P3), not
  // yet built. index.md §5 freezes this command as appending Published
  // directly (no job dispatch), so we synthesize a deterministic result
  // from the command body until P3's publish result event replaces this.
  const postId = randomUUID()
  const event: VidgenEvent = {
    v: 1,
    type: 'Published',
    projectId: input.projectId,
    at: ctx.now(),
    platform: input.privacy,
    postId,
    url: `https://vidgen.local/p/${postId}`,
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  return foldProject([...events, event])
}

export async function resolveMaterial(ctx: CommandContext, input: ResolveMaterialInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('ResolveMaterial', state)
  for (const scene of state.scenes) {
    await dispatchJob(ctx.js, 'material', input.projectId, scene.idx, { narration: scene.narration, visual: scene.visual })
  }
  return state
}

export async function generateVoiceovers(ctx: CommandContext, input: GenerateVoiceoversInput): Promise<ProjectState> {
  const events = await ctx.store.loadEvents(input.projectId)
  const state = assertExists(events, input.projectId)
  assertTransition('GenerateVoiceovers', state)
  const additionalUsd = projectedTtsUsd(state.scenes)
  const result = admit(state, additionalUsd, ctx.costCapUsd)
  if (!result.admitted) {
    throw new CostCapExceededError(result.projectedUsd, result.capUsd)
  }
  const event: VidgenEvent = {
    v: 1,
    type: 'CostProjected',
    projectId: input.projectId,
    at: ctx.now(),
    projectedUsd: result.projectedUsd,
    capUsd: result.capUsd,
  }
  await ctx.store.append(event)
  await publishEvent(ctx.js, event)
  for (const scene of state.scenes) {
    await dispatchJob(ctx.js, 'tts', input.projectId, scene.idx, { narration: scene.narration })
  }
  for (const scene of state.scenes) {
    await dispatchJob(ctx.js, 'caption', input.projectId, scene.idx, {})
  }
  return foldProject([...events, event])
}
