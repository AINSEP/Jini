---
name: performance-engineering
version: 1.0.0
last_updated: 2026-02-26
description: Standardizes performance validation in the standard pipeline. Extracts and generalizes the performance harness.
---

# Skill: Performance Engineering

Performance is a spec requirement, not an afterthought. When a spec declares latency or throughput NFRs, those targets are as binding as functional acceptance criteria. This skill standardizes how performance is validated — what to measure, how to measure it, and what constitutes a pass or fail.

## When Performance Validation is Required

- Any spec with a latency NFR (p50/p95/p99 target).
- Any spec with a throughput NFR (requests per second, concurrent users).
- Any spec with an availability SLA.
- When none of the above: performance validation is optional (document as N/A in pipeline state).

## Load Testing Tools

- **k6**: JavaScript-based, CI-friendly, good for HTTP APIs — preferred default.
- **autocannon**: Node.js, minimal setup, good for quick HTTP benchmarks.
- **Artillery**: YAML-driven, good for complex scenarios.
- Never use unit test timing assertions as performance tests — they do not simulate real load.

## Test Scenario Design

- **Warm-up phase**: ramp from 0 to target load over 30 seconds (avoids cold-start skew).
- **Sustained load phase**: hold target load for 60+ seconds.
- **Measure**: p50, p95, p99 latency; error rate; throughput (req/s).
- Simulate realistic payloads — not empty requests.

## Pass/Fail Criteria

- p99 latency must meet spec NFR target.
- Error rate during load test must be < 0.1% (unless spec specifies otherwise).
- A result 0-10% over p99 target: warning (Engineering Lead acknowledgment required before merge).
- A result >10% over p99 target: hard failure (blocks merge).

## Result Artifacts

- Load test results must be captured as CI artifacts and attached to the PR.
- Results must include: tool used, scenario description, VU count, duration, p50/p95/p99 values, error rate, pass/fail verdict.
- When the benchmark is tied to a service-level objective, use `references/error-budget-and-burn-rates.md` to interpret whether the result is merely noisy or actually spending reliability budget too fast.

## Common Performance Failure Modes

- **N+1 query**: one query per row instead of one query total — fix with eager loading or batching.
- **Missing database index**: full table scan on filtered query — fix with index on filter column(s).
- **Synchronous blocking I/O in hot path**: network call or disk read blocking the event loop.
- **Cold-start latency**: first request penalty — warm up before measuring.

## References

For web/frontend performance work, load `references/web-performance-targets.md` for Core Web Vitals targets, image optimization patterns, and performance budgets.
