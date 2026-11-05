---
name: observability-implementation
version: 1.0.0
last_updated: 2026-02-26
description: Implementation-level guidance for meeting Constitution Article VIII (Observability), including structured logging, metrics, tracing, and alerting.
---

# Skill: Observability Implementation

Observability is not logging. It is the ability to ask arbitrary questions about a running system without deploying new code. This skill governs how agents implement the three pillars — logs, metrics, and traces — so that every production path produces structured signals sufficient for debugging without reproduction. Constitution Article VIII requires this; this skill defines how to deliver it.

## Structured Logging

- **Log levels**: Use DEBUG for local dev, INFO for normal ops, WARN for expected errors, ERROR for unexpected errors, FATAL for unrecoverable failures.
- **Structured log format**: always JSON in production, include `timestamp`, `level`, `service`, `trace_id`, `span_id`, `message`, `context` fields.
- **What to log**: Log at each application layer (HTTP handler, service, repository).
- **What never to log**: secrets, PII, full request bodies containing sensitive fields — reference `<AI_DEV_SHOP_ROOT>/framework/governance/data-classification.md`.
- **Correlation ID propagation**: inject at the edge for every request, job, or agent run, and forward through all downstream calls.

## Metrics

- **Counter, gauge, histogram**: Use counter for absolute counts, gauge for point-in-time values, histogram for distributions (e.g. latency).
- **Standard metrics**: every service must emit request count, error rate, latency histogram (p50/p95/p99), saturation (queue depth, connection pool usage).
- **OpenTelemetry SDK setup pattern**: Adopt standard OpenTelemetry instrumentation and export protocols across languages.
- **Prometheus exposition format**: Expose metrics in Prometheus format when applicable.

## Distributed Tracing

- **Span creation**: create a new span for service boundaries, external calls, and significant internal operations.
- **Span attributes**: required (service name, operation name, span kind) and recommended (user ID hash — not raw, feature flag values, resource identifiers).
- **Context propagation**: across HTTP and message queue boundaries use W3C TraceContext headers.
- **Sampling strategy guidance**: always-on for errors, probabilistic for success paths.

## Alerting Design (for Software Architect to specify in ADR)

- Alert on symptoms (high error rate, high latency) not causes (CPU usage, memory).
- Alert thresholds must be defined in the spec as NFRs — not added post-launch.
- Every alert must have a runbook reference.
- For production SLOs, golden-signal coverage, and runbook minimums, read `references/sre-golden-signals.md` and `references/service-runbook-minimums.md`.

## Implementation Checklist for Programmer Agent

- [ ] Correlation ID injected at first entry point and propagated to all outbound calls
- [ ] All external I/O instrumented (HTTP calls, DB queries, queue publishes/consumes)
- [ ] Error paths produce structured log entry with error type, message, and stack trace
- [ ] Request latency histogram emitted per endpoint
- [ ] Health check endpoint returns 200 with service metadata (version, uptime)
- [ ] No secrets or raw PII in any log output

## References

Before designing any telemetry, load `references/observability-principles.md` for the define-working-first discipline, RED/USE frameworks, cardinality rules, and alerting requirements.
