import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Hard rule: body-text tiers stay WCAG AA legible on every paper surface ───
//
// The control-room palette pairs three ink tiers (--ink-1 primary, --ink-2
// secondary, --ink-3 muted) against four paper surfaces. The muted tier once
// shipped at #8b9184 — ~2.6–3.2:1, well under the 4.5:1 body-text floor — so
// engine labels, event-log timestamps, the project idea and scene indices were
// hard to read (impeccable audit P1). This test recomputes the WCAG 2.1
// contrast ratio straight from tokens.css and fails the frontend `bun test`
// gate if any text tier drops below AA on any surface, so the muted tier can't
// be quietly lightened again.
//
// The lightest inset well (--paper-3) is the binding surface.

const tokens = readFileSync(join(import.meta.dir, 'tokens.css'), 'utf8')

function hex(varName: string): string {
  const m = tokens.match(new RegExp(`${varName.replace(/[-]/g, '\\-')}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`token not found in tokens.css: ${varName}`)
  return m[1]
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(h: string): number {
  const n = parseInt(h.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Text tiers used as `color:` on paper surfaces, and every paper surface they
// can land on. --ink-3 (muted) on --paper-3 (inset) is the tightest pairing.
const TEXT_TIERS = ['--ink-1', '--ink-2', '--ink-3'] as const
const SURFACES = ['--paper-0', '--paper-1', '--paper-2', '--paper-3'] as const
const AA_BODY = 4.5

describe('text tiers meet WCAG AA (4.5:1) on every paper surface', () => {
  for (const tier of TEXT_TIERS) {
    for (const surface of SURFACES) {
      it(`${tier} on ${surface}`, () => {
        const ratio = contrast(hex(tier), hex(surface))
        expect(ratio).toBeGreaterThanOrEqual(AA_BODY)
      })
    }
  }
})
