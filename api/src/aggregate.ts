import { foldProject } from './events.js'
import type { VidgenEvent, ProjectState } from './events.js'

export { foldProject }
export type { ProjectState }

export type CommandName =
  | 'CreateProject'
  | 'GenerateScript'
  | 'ResolveMaterial'
  | 'GenerateVoiceovers'
  | 'RequestApproval'
  | 'ApproveStoryboard'
  | 'TuneProject'
  | 'Publish'

export class ProjectAlreadyExistsError extends Error {
  constructor(public readonly projectId: string) {
    super(`project ${projectId} already has events`)
    this.name = 'ProjectAlreadyExistsError'
  }
}

export class ProjectNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`project ${projectId} has no events`)
    this.name = 'ProjectNotFoundError'
  }
}

export class InvalidTransitionError extends Error {
  constructor(public readonly command: CommandName, public readonly from: ProjectState['status']) {
    super(`command ${command} is not legal from status "${from}"`)
    this.name = 'InvalidTransitionError'
  }
}

/** Input failed a domain rule (bad voice, speed/volume out of range). Distinct
 * from InvalidTransitionError, which is about lifecycle status, not payload. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/** Legal status a command may run from. Mirrors the linear pipeline the Go
 * CLI already proved (draft→scripted→material→awaiting_approval→approved→
 * rendered→published), renamed to the frozen ProjectStatus values. */
const LEGAL_FROM: Record<Exclude<CommandName, 'CreateProject'>, ReadonlyArray<ProjectState['status']>> = {
  GenerateScript: ['draft'],
  ResolveMaterial: ['scripted'],
  GenerateVoiceovers: ['material'],
  RequestApproval: ['material'],
  ApproveStoryboard: ['awaiting_approval'],
  TuneProject: ['draft', 'scripted', 'material', 'awaiting_approval'],
  Publish: ['rendered'],
}

export function assertCanCreate(events: VidgenEvent[], projectId: string): void {
  if (events.length > 0) {
    throw new ProjectAlreadyExistsError(projectId)
  }
}

export function assertExists(events: VidgenEvent[], projectId: string): ProjectState {
  if (events.length === 0) {
    throw new ProjectNotFoundError(projectId)
  }
  return foldProject(events)
}

export function assertTransition(command: Exclude<CommandName, 'CreateProject'>, state: ProjectState): void {
  if (!LEGAL_FROM[command].includes(state.status)) {
    throw new InvalidTransitionError(command, state.status)
  }
}
