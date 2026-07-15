---
target: c3-3002
scope: whole
type: component
parent: c3-30
title: natsClient — NATS WebSocket event subscription
---
## Goal

Subscribe to VIDGEN_EVENTS over NATS WebSocket (nats.ws) to receive live events and update the Zustand store.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-30 frontend |
| Category | foundation |
| Boundary | Browser; connects to NATS WebSocket on port 8081 (Docker Compose ws port) |
| Status | active |

## Purpose

Owns the natsClient connection lifecycle, VIDGEN_EVENTS subscription, and event deserialization → store.handleEvent dispatch. Non-goal: does not own command dispatch — that is store.ts.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| rule-no-any-data | rule | Events deserialized as typed VidgenEvent before dispatch to store | high | N.A - no additional notes |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| subscribeEvents | OUT | Connects to NATS WebSocket; subscribes to vidgen.evt.> ; dispatches typed VidgenEvent to store | WebSocket | frontend/src/store/natsClient.ts |

| connect | OUT | Establishes NATS WebSocket connection and returns client handle | browser | frontend/src/store/natsClient.ts |
## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| WebSocket port | Contract | N.A - exact port | docker-compose.yml |
