---
name: data-engineering
version: 1.0.0
last_updated: 2026-03-13
description: Use when designing or implementing ETL/ELT pipelines, warehouses, lakehouses, CDC flows, streaming jobs, or data-quality and schema-evolution controls.
---

# Skill: Data Engineering

Use this for ETL/ELT, CDC, warehouse/lakehouse work, streaming jobs, and analytics-serving layers. Do not use it for ordinary OLTP schema design.

## Trigger

- Building ETL or ELT pipelines
- Designing Bronze/Silver/Gold or similar layered data flows
- Adding CDC, backfills, or replay mechanisms
- Choosing between batch, micro-batch, and streaming
- Defining data contracts, freshness SLAs, and quality checks
- Implementing warehouse, lakehouse, or analytics-serving models

## Rules

- Every pipeline is idempotent. Reruns must not duplicate or corrupt outputs.
- Source contracts are explicit. Schema drift must alert, not silently mutate trusted layers.
- Raw ingest is immutable. Cleansing and business logic happen in downstream layers.
- Consumers read only from the layer that matches their trust and latency needs.
- Backfills, replays, and late-arriving data are planned up front, not improvised during failure.

## Workflow

1. Define the contract: owner, schema, keys, freshness, lateness, replay window.
2. Choose ETL vs ELT and batch vs streaming.
3. Design layer boundaries and promotion rules.
4. Define idempotency strategy, checkpointing, and deduplication keys.
5. Define data quality checks, null handling, and schema evolution policy.
6. Plan lineage, alerting, backfills, and consumer communication.

## References

- Layer design and promotion rules: `references/medallion-architecture.md`
- Idempotency, backfills, and quality gates: `references/pipeline-reliability.md`
- Streaming, CDC, and schema evolution: `references/streaming-and-schema-evolution.md`
