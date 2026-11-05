# Medallion Architecture

Use this when the data system has multiple trust levels or multiple consumer classes.

## Bronze

Purpose: raw ingest and historical replay.

Rules:
- append-only whenever possible
- preserve source fields and metadata
- no business logic
- retain source identifiers, ingestion timestamp, and lineage metadata

Consumers:
- platform operators
- replay and audit workflows

## Silver

Purpose: clean, deduplicated, conformed data.

Rules:
- standardize types and codes
- apply deduplication rules
- handle nulls explicitly
- enforce entity-level contracts

Consumers:
- downstream transformations
- cross-domain joins
- trusted intermediate models

## Gold

Purpose: business-ready, SLA-backed outputs.

Rules:
- optimized for known access patterns
- aggregated or denormalized only with clear consumer need
- freshness and correctness commitments are explicit
- changes require downstream communication

Consumers:
- dashboards
- reverse ETL
- ML feature serving
- external data products

## Promotion Rule

Data only moves up a layer when:
- schema is understood
- quality gates pass
- the next layer's contract is satisfied

Do not let Gold consumers query Bronze directly.
