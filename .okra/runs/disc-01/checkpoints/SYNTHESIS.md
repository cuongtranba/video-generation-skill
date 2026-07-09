# disc-01 synthesis — discovery go/no-go

Date: 2026-07-09 · Run: disc-01 · Branch: `feat/webapp-rewrite`

## Spike outcomes

| Spike | Result | Confidence |
|---|---|---|
| **D1** Agent SDK integration | Structured JSON output works 3/3; auth = local `claude` CLI subscription (no API key). `total_cost_usd` is **notional**, not real spend. | FLAG (design constraint, not blocker) |
| **D2** Event model | v1 catalogue (11 types, `v:1`) frozen; `foldProject` aggregate verified by 2 passing tests. | HIGH |
| **D3** nats.ws browser consumer | JetStream-over-WebSocket proven twice — headless Node + real Chromium tab, live DOM append, ≤260ms (WS transport 1–5ms). | HIGH |
| **D4** Go worker ↔ event store | `nats.go/jetstream` publish + `WithMsgID` dupe-window = event-level idempotency; dedup test green, `go vet` clean. | HIGH |

## The D1 finding (the one frame value the loop could not invent)

The plan assumed `total_cost_usd ≈ $0`. **Empirically false.** The SDK reports a notional per-token estimate (observed **$0.14–$0.38**/call, defaulting to `claude-opus-4-8`, the priciest tier) computed from token counts × published API list pricing. Under the Claude Max **subscription** there is no per-token billing, so **true marginal cost = $0** — the field is observability parity for API-key users, not a charge.

- **Anti-goal still holds:** real per-video cost = $0 (script) + ~$0.004 (FPT TTS) + $0 (render) ≈ **$0.004**, ~37× under the `COST_CAP_USD` $0.15 cap. No cap change needed; human-ratified $0.15 stands.
- **Design constraint for the rewrite (binding on the cost-wall component):** the cost ledger MUST treat SDK `total_cost_usd` / `modelUsage.costUSD` as **notional** for subscription-auth runs and **exclude it from the real per-video dollar sum**. A ledger that naively sums `total_cost_usd` would blow the $0.15 cap on phantom money from a single script-gen call. Recommended: `ScriptGenerated.scriptUsd = 0` (subscription); optionally record notional cost in a separate non-enforced field for observability. Pinning a cheaper model lowers the notional number but not the real ($0) cost.

## Paired anti-goal read

1. Real per-video cost ≈ $0.004 ≤ $0.15 cap ✅ (by 37×).
2. No secret material (API keys, tokens) appended to any event in the probes ✅ — spikes published only `Ping` and `{"v":1}` payloads; auth is CLI-subscription, no key ever in env or payload.
No `breaking`/`cannot`/authority-drift flag open. D1 FLAG is a design note carried into execution, not a stop.

## Verified facts to carry into implementation

- **Event contract (D2):** subjects `vidgen.evt.<projectId>.<type>`; 11-type `v:1` union; `foldProject` fold logic.
- **Browser transport (D3):** `wsconnect` from `@nats-io/nats-core` (browser WS), `connect` from `@nats-io/transport-node` (Node TCP), `jetstream` + `js.consumers.get(stream)` (ordered ephemeral) from `@nats-io/jetstream`. WS listener `ws://…:8080` (host 8081 in this env).
- **Worker contract (D4):** `js.Publish(ctx, subj, data, jetstream.WithMsgID(id))`; `OrderedConsumer{FilterSubjects}` for replay-safe per-subject consume; tune `FetchMaxWait`/`PullMaxMessages` to avoid Fetch stalls.
- **SDK shape (D1):** `query({ prompt, options:{ outputFormat:{ type:'json_schema', schema } } })`; read `message.structured_output` + `message.total_cost_usd` on `type:'result'`.
- **Infra:** host ports remapped 4223/8081/8223 (4222/8222 held by another project's nats); container internals unchanged.

## GO / NO-GO

**GO.** Discovery funnel closed — all four load-bearing unknowns resolved with evidence. Proceed to per-subsystem implementation plans:
1. TS `api`: Project aggregate + command handlers + Postgres projections (cost ledger carries the D1 notional-vs-real rule).
2. Agent SDK script service (`scriptUsd = 0`, notional recorded separately).
3. Go `worker` event-store adapter (msgID idempotency replaces output-file check).
4. React/Zustand SPA + nats.ws store + ESLint local-state ban + fixture test.
5. Delete CLI + C3 change-unit (CLI → webapp topology).
