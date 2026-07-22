---
target: c3-3003
scope: block
base: c3-3003#n816@v1:sha256:12e3b7d1b73ba0b9edc2bd06708f62c9668749c90dde438dad572119b6408493
---
Owns the Board component that maps the Zustand projects map to a vertical stack of PipelineCard components. Non-goal: does not own per-project pipeline rendering or actions — those live in PipelineCard and its children (PipelineNode, StepDetail, EventLog).
