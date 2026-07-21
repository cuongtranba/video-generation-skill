---
target: c3-1006
scope: block
base: c3-1006#n318@v1:sha256:ebca294141a64dbcb4082a4fc87d8c7bc27da881823bc3129e64c0d4efa3570c
---
Owns projectedTtsUsd (per-character TTS_USD_PER_CHAR = $0.00001), admit (dry-run cost gate), CostCapExceededError, costCapFromEnv (COST_CAP_USD env, default $0.15), and readLedger (Postgres cost_ledger query). Non-goal: the cap constant is configuration, not a compile-time value; admin can raise it via env.
