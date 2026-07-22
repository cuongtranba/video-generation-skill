---
id: rule-i18n-no-hardcoded-strings
c3-seal: d54bfc83cb91cc681dccda49415b507071971178d5d2bf628648ee764ea46028
title: i18n-no-hardcoded-strings
type: rule
goal: |-
    All user-facing copy in the frontend SPA is rendered through the i18next
    translation layer, never hardcoded in a component. Vietnamese is the default
    language and English is the fallback; adding or changing UI text means editing
    the shared dictionaries, so every string is translatable in both locales and
    the product stays Vietnamese-first by construction.
---

## Goal

All user-facing copy in the frontend SPA is rendered through the i18next
translation layer, never hardcoded in a component. Vietnamese is the default
language and English is the fallback; adding or changing UI text means editing
the shared dictionaries, so every string is translatable in both locales and
the product stays Vietnamese-first by construction.

## Rule

All UI text in `frontend/src/components/**` and `frontend/src/ui/**` must be rendered via `t('key')` from `react-i18next`; a JSX text node containing letters is never hardcoded.

## Golden Example

```tsx
// frontend/src/components/Board.tsx
import { useTranslation } from 'react-i18next' // REQUIRED
import { useVidgenStore } from '../store/store'
import { PipelineCard } from './PipelineCard'

export function Board() {
  const { t } = useTranslation() // REQUIRED — hook, not component-local state
  const projects = useVidgenStore((state) => state.projects)
  const projectIds = Object.keys(projects)

  if (projectIds.length === 0) {
    // REQUIRED — copy comes from frontend/src/i18n/locales/{vi,en}.json,
    // rendered as an expression, never a bare JSX text node.
    return <p className="vg-board vg-board--empty">{t('board.empty')}</p>
  }
  // ...
}
```

The key `board.empty` exists in both `frontend/src/i18n/locales/vi.json`
("Chưa có dự án nào") and `frontend/src/i18n/locales/en.json` ("No projects yet").

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| <p>No projects yet</p> | <p>{t('board.empty')}</p> | A hardcoded English string cannot render in Vietnamese; breaks the default-VN promise. |
| <button>{'output.mp4'}</button> to dodge the gate | <button>{t('step.render.outputName')}</button> | Even language-invariant tokens go through a key so the wall stays at 100% with no special cases. |
| const LABEL = { live: 'Live' } then {LABEL[s]} | {t(\connection.\${s}\`)}` | A literal-string lookup table is untranslated copy one indirection away. |

## Scope

Applies to every module under `frontend/src/components/**` and
`frontend/src/ui/**` except their `*.test.ts(x)` files. Does not apply to the
`api/` or `worker/` services (no browser UI), nor to `frontend/src/pipeline/**`
data/formatting helpers, nor to non-UI values such as CSS class names, element
ids, `data-*` attributes, or narration-language content values sent to the API.

## Override

None. Enforced in CI by the ast-grep rule `no-hardcoded-jsx-text`
(`rules/no-hardcoded-jsx-text.yml`, run via `bun run lint:sg`). A genuinely
language-invariant token must still resolve through a `t()` key whose vi and en
values are identical — there is no exemption list for hardcoded text.
