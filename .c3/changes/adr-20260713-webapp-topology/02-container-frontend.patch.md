---
target: c3-4
scope: whole
type: container
parent: c3-0
boundary: Vite/React/TS SPA, browser-only, no server-side logic beyond static serving
---
## Goal

Be the single browser surface for the webapp: subscribe to the NATS event store directly over WebSocket, render the live project board, dispatch commands to `api`, and gate render on the storyboard-approval flow — with all state and side effects centralized in one Zustand store so components stay pure and testable.

## Components

| ID | Name | Category | Status | Goal Contribution |
|---|---|---|---|---|

## Responsibilities

Owns the `nats.ws` browser connection and ordered event consumer, the single Zustand store (state + event-fold reducers + command thunks + connection lifecycle), and the pure presentational components that read store selectors and dispatch store actions only.
