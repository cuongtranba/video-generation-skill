import { randomUUID } from 'node:crypto'
import type { Scene, VidgenEvent, ProjectState } from './events.js'
import { foldProject } from './events.js'
import { assertCanCreate, assertExists, assertTransition } from './aggregate.js'
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

export interface CommandContext {
  store: EventStore
  js: Publisher
  scriptGen: ScriptGenerator
  now: () => string
  costCapUsd: number
}

export function createCommandContext(
  store: EventStore,
  js: Publisher,
  scriptGen: ScriptGenerator,
  costCapUsd: number = costCapFromEnv(),
): CommandContext {
  return { store, js, scriptGen, now: () => new Date().toISOString(), costCapUsd }
}

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
