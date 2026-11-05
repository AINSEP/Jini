# Streaming and Schema Evolution

## Streaming Decision Points

Choose streaming only when latency requirements justify operational cost.

Use streaming when:
- business value degrades quickly with stale data
- event order or continuous enrichment matters
- downstream actions depend on near-real-time signals

Use batch or micro-batch when:
- freshness targets are minutes or hours
- sources are unstable or expensive to process continuously
- operational simplicity matters more than seconds-level latency

## Exactly-Once vs At-Least-Once

- Exactly-once is expensive and should be justified by business risk.
- At-least-once is common; pair it with deterministic deduplication.

Always document:
- event identifier
- ordering guarantees
- duplicate handling strategy
- late-arrival policy

## CDC Guidance

For CDC pipelines define:
- source cursor or LSN/watermark
- delete handling
- snapshot bootstrap strategy
- resync path after cursor loss

## Schema Evolution

Treat schema changes as contract changes.

Safe changes:
- additive nullable columns
- additive fields ignored by old consumers

Risky changes:
- type changes
- semantic meaning changes
- required columns with no default
- renamed fields without compatibility layer

For risky changes, use a compatibility window with dual-write, dual-read, or versioned models.
