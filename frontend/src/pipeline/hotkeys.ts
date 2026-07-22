import type { StepInfo } from './derive'

// Single source of truth for the pipeline rail's scoped action hotkeys, consumed
// by BOTH the rail keydown handler (to dispatch) and StepDetail (to label the
// buttons) so the two can never drift. See
// docs/superpowers/specs/2026-07-22-pipeline-keyboard-control-design.md.

export type HotkeyAction = 'approve' | 'reject' | 'retry'

export interface Hotkey {
  /** Lowercase key that triggers the action. */
  key: string
  action: HotkeyAction
  /** Uppercase display cap for the button hint. */
  cap: string
}

// The action hotkeys available for a step in its current state. Only the human
// gate (awaiting) and a failed step expose any — every other state is inert.
export function stepHotkeys(step: StepInfo): Hotkey[] {
  if (step.key === 'gate' && step.state === 'awaiting') {
    return [
      { key: 'a', action: 'approve', cap: 'A' },
      { key: 'r', action: 'reject', cap: 'R' },
    ]
  }
  if (step.state === 'failed') {
    return [{ key: 'r', action: 'retry', cap: 'R' }]
  }
  return []
}

// The action a pressed key maps to for a step, or undefined if the key is inert.
export function hotkeyFor(step: StepInfo, pressed: string): HotkeyAction | undefined {
  const key = pressed.toLowerCase()
  return stepHotkeys(step).find((h) => h.key === key)?.action
}
