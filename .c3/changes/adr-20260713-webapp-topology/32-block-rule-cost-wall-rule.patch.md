---
target: rule-cost-wall
scope: block
base: rule-cost-wall#n84@v1:sha256:6bdcee7ca4ae5432a7f218019005e1725ec9faefcfc71348a04b80c3ac00ead5
---
## Rule

Cost is checked against COST_CAP_USD (config, default 0.15) both projected (before any spend-triggering command dispatches) and actual (read from the cost_ledger projection after); the checks are never removed or loosened; Agent SDK notional total_cost_usd never enters the enforced total.
