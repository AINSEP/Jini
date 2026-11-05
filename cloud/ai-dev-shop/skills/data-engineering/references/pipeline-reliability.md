# Pipeline Reliability

## Idempotency First

Design each stage so the same input can be processed repeatedly with the same final result.

Common patterns:
- merge/upsert on stable business key
- append raw events, dedupe later with event ID
- write-once output partition plus atomic swap/promotion

## Backfills and Replays

Before implementation, define:
- replay range
- replay source of truth
- partition selection rules
- validation method against current outputs

Never run a backfill without a comparison plan.

## Data Quality Gates

At minimum check:
- row presence / freshness
- key uniqueness
- referential integrity
- accepted value ranges
- nullability on critical columns

Decide per check whether failure should:
- block promotion
- quarantine records
- warn only

## Operational Metadata

Each stage should emit:
- run ID
- input range
- output row count
- bad record count
- schema version
- duration

## Recovery Plan

Every pipeline should document:
- how to rerun safely
- how to skip or quarantine bad input
- how to restore the prior serving state
- who owns consumer communication if freshness degrades
