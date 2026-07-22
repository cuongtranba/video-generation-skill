import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Hard rule: the Pipeline Home rail must never clip a stage ────────────────
//
// The rail lays out every pipeline stage (SCRIPT → MATERIAL → VOICEOVER →
// CAPTIONS → APPROVAL → RENDER) in ONE horizontal flex row. If the node tiles
// carry a FIXED pixel width, six tiles + connector edges (~938px) exceed the
// 960px app shell (~878px usable), the rail's `overflow-x` clips the final
// RENDER node, and it silently disappears with no scroll affordance — the exact
// regression fixed on branch `fix-board-clip`.
//
// The invariant that makes clipping impossible: rail tiles must FLEX to share
// the available width, never a hard `width: <n>px`. This test fails the build
// (frontend `bun test` CI job) if anyone reintroduces a fixed-width rail tile.
//
// happy-dom computes no layout, so this guards the CSS source directly rather
// than the rendered geometry.

const css = readFileSync(join(import.meta.dir, 'app.css'), 'utf8')

// Body of the rule whose selector is EXACTLY `selector { … }` (the bare tile
// rule, not `.vg-node__head`, `.vg-node:hover`, `.vg-node[data-state=…]`, …).
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`selector not found in app.css: ${selector}`)
  return match[1]
}

// `width: 132px` but NOT `min-width` / `max-width` (lookbehind rejects `-`/word char).
const FIXED_PX_WIDTH = /(?<![-\w])width:\s*\d+(?:\.\d+)?px/

describe('pipeline rail never clips a node (fixed-width tile ban)', () => {
  it('.vg-node flexes to share the rail width', () => {
    expect(ruleBody('.vg-node')).toMatch(/\bflex:\s*1\b/)
  })

  it('.vg-node has no fixed pixel width', () => {
    expect(ruleBody('.vg-node')).not.toMatch(FIXED_PX_WIDTH)
  })

  it('.vg-node--gate has no fixed pixel width', () => {
    expect(ruleBody('.vg-node--gate')).not.toMatch(FIXED_PX_WIDTH)
  })
})
