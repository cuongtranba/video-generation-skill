---
target: c3-0
scope: block
base: c3-0#n14@v1:sha256:11308e18f1d3a4bcd543fc3d967be26f707825be4e148a19db15f34ff9bdf86d
---
| Asynchronous work is idempotent: output-exists check before any paid/slow op; event appends use Nats-Msg-Id deduplication | Re-runs and JetStream redelivery must cost $0 and never duplicate artifacts | c3-2, c3-3 |
