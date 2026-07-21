# vidgen design system

A small, dark-themed React design system for **vidgen** (a 9:16 short-video
generation tool). Warm charcoal surfaces, one amber accent, status tones for a
live event board. Components are plain React — import from the bundle, pass
props. No CSS framework, no className juggling.

## Wrapping (required for correct rendering)

Wrap the app (or any composition) in **`Surface`** — the theme root. It sets the
dark canvas: background, text color, and the base font. Tokens live on `:root`
so `var(--vg-*)` resolves anywhere, but element/background defaults come from
`Surface`. Without it, your layout renders on the host's default (usually white)
background and the design looks broken.

```jsx
<Surface>
  <YourScreen />
</Surface>
```

## Components

`Surface`, `Card`, `Panel`, `Field`, `Button`, `Badge`, `Callout`,
`EmptyState`, `Stack`. Each has a `.d.ts` (its exact props) and a `.prompt.md`
(usage + examples) — read those before composing. Highlights:

- **`Button`** — `variant="primary|ghost|danger"` (default primary), `size="sm|md"`, plus native button attrs. Primary is the amber call-to-action; use one per view.
- **`Badge`** — `tone="neutral|good|bad"`. Status pills (connection state, cost).
- **`Card`** — surface container with optional `title` / `meta` / `actions` header slots; children stack in the body.
- **`Panel`** — titled `<fieldset>` (`legend` prop); `disabled` freezes every control inside. For grouped form controls.
- **`Field`** — `label` + `htmlFor` wrapping one or more native controls (`wide` spans a form row).
- **`Callout`** — inline message strip, `tone="info|good|warn|error"`.
- **`EmptyState`** — muted placeholder for empty lists (optional `icon`).
- **`Stack`** — vertical layout, `gap="xs|sm|md|lg"`.

## Styling idiom: props + tokens, not classes

Style through **component props**, never by hand-writing the internal `vg-*`
classes (those belong to the components). For your own layout glue and any
custom element, use the design tokens as CSS variables — this is how you stay
on-brand:

- **Color**: `--vg-color-surface-0|1|2|3` (canvas → raised), `--vg-color-text`, `--vg-color-text-muted`, `--vg-color-text-faint`, `--vg-color-border`, `--vg-color-accent` (amber), `--vg-color-good` / `--vg-color-bad` / `--vg-color-warn` / `--vg-color-neutral`.
- **Space**: `--vg-space-3xs|2xs|xs|sm|md|lg|xl|2xl`.
- **Radius**: `--vg-radius-sm|md|lg|pill`. **Type**: `--vg-text-xs…xl`, `--vg-font-sans`. **Elevation**: `--vg-shadow-sm|md|lg`. **Motion**: `--vg-ease`, `--vg-dur`.

```jsx
<div style={{ display: 'flex', gap: 'var(--vg-space-md)', color: 'var(--vg-color-text-muted)' }}>
  <span style={{ color: 'var(--vg-color-accent)' }}>●</span> live render
</div>
```

## Where the truth lives

The full token set + component CSS is in the bound `styles.css` (and its
`@import` closure — tokens, the Hanken Grotesk `@font-face`, and
`_ds_bundle.css`). Read it before inventing values; read each component's
`.d.ts` / `.prompt.md` before composing it.

## Build snippet

```jsx
import { Surface, Card, Badge, Button } from '<bundle>'

<Surface>
  <Card title="surfing-cat-01" meta="draft" actions={<Badge tone="neutral">$0.02</Badge>}>
    <p style={{ color: 'var(--vg-color-text-muted)', fontSize: 'var(--vg-text-sm)' }}>
      A calico cat learns to surf at sunrise.
    </p>
    <Button variant="ghost" size="sm">Select</Button>
  </Card>
</Surface>
```
