---
target: c3-3004
scope: block
base: c3-3004#n840@v1:sha256:9b3742176bc43b1f903c2b9b267389796c7df15f5e01cdb946fdc0d18266ccd9
---
Owns PipelineCard: the card header (id, status tally, idea, cost cap, CostBadge), the node rail with flow edges, and the detail+log footer. Derives per-step state from ProjectState plus the raw event log via the pipeline model component. Non-goal: does not own step visualization internals or the pure derivation — those are PipelineNode/StepDetail/EventLog and the pipeline model component.
