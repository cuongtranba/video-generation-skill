---
id: adr-20260722-auth-and-i18n
c3-seal: 8a686086ba00e460168264a16452892159c02b90d678b0d4010152f3b795b168
title: auth-and-i18n
type: adr
goal: |-
    Gate the entire vidgen app behind a single-user login (signed-cookie session)
    and make the SPA Vietnamese by default with an English switcher, without
    changing the service topology. Add a hard rule that keeps UI copy 100%
    i18n-translated.
status: accepted
date: "2026-07-22"
---

## Goal

Gate the entire vidgen app behind a single-user login (signed-cookie session)
and make the SPA Vietnamese by default with an English switcher, without
changing the service topology. Add a hard rule that keeps UI copy 100%
i18n-translated.

## Context

The api HTTP surface (c3-1008) was fully open: any client reaching it could
drive every command and read every projection. The SPA (c3-30 / c3-3001) was
English-only with hardcoded strings in components. The product is
Vietnamese-first and needs access control. Constraint: no new services, keep
the event-sourced flow untouched, and keep the login form / language switcher
at the existing presentational granularity (ConnectionStatus and
CreateProjectForm are not tracked components either, so the two new
presentational components are not modeled as facts).

## Decision

Add a stateless signed-cookie auth layer (`api/src/auth.ts`, HMAC-SHA256 over
`{u, exp}`, HttpOnly `vg_session`, timing-safe credential compare) with three
public routes (`POST /api/login`, `POST /api/logout`, `GET /api/session`) and an
auth gate in `routeRequest` returning 401 for any other `/api/*` without a valid
session; the SPA and `/media` stay open so the login page loads. Mirror session
state in a Zustand `auth` slice (c3-3001) probed on bootstrap, gating the board
behind a `LoginForm`. Adopt react-i18next (vi default, en fallback, localStorage
persistence) with a `LanguageSwitcher`; move all UI copy to `locales/{vi,en}.json`
and flip the new-project narration default to Vietnamese. Enforce translation
with rule-i18n-no-hardcoded-strings + the ast-grep gate `no-hardcoded-jsx-text`.
A stateless signed cookie is chosen over a server-side session store to avoid
new infra for a single-user credential.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-1008 | component | Gains the auth gate + login/logout/session endpoints on the HTTP surface | c3-1008#n465@v1:sha256:41085189ce0795a15bf80d4e431afd85a6ca7972990b7a06fbf5c96bb690dabf "Owns createHttpServer, COMMAND_HANDLERS dispatch map (8 commands)" | rule-no-any-data — parsed login body stays typed |
| c3-3001 | component | Gains the session/auth Zustand slice (checkSession, login, logout) | c3-3001#n802@v1:sha256:ca56c8d97eff60f738c12522c8d585a83b2a63985b28650ef2c46931c9fef17d "Owns the Zustand store (projects map keyed by projectId)" | rule-frontend-store-state — auth state lives in the store |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-i18n-no-hardcoded-strings | All new/edited frontend UI copy must render via t(); this ADR moves every string to the dictionaries | rule-i18n-no-hardcoded-strings#n1111@v1:sha256:440c19717aff5342a87322e0201d11d6fff81b6a4aa51fd6f21bad77754331eb "All UI text in frontend/src/components/** and frontend/src/ui/** must be rendered via t('key') from react-i18next; a JSX text node containing letters is" | create-rule (added directly; comply across components/ui) |

## Verification

| Check | Result |
| --- | --- |
| cd api && bun test $(ls src/*.test.ts \| grep -v integration) | 97 pass, 0 fail (incl. src/auth.test.ts) |
| cd api && bunx tsc --noEmit | clean |
| cd frontend && bun test | 112 pass, 0 fail (incl. auth + LoginForm + LanguageSwitcher) |
| cd frontend && bun run typecheck && bun run lint && bun run build | typecheck/oxlint clean; vite build succeeds |
| bun run test:sg && bun run lint:sg | rule self-tests pass; scan clean (no-hardcoded-jsx-text enforced) |
