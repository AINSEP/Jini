# Memory Store

Structured project memory entries can live here when a workflow needs tagged retrieval.

## Entries

- id: `quality.coverage-integrity`
  date: `2026-07-24`
  scope: `repository-wide`
  tags: `quality, testing, coverage, security, capability-preservation`
  rule: Coverage must be raised through meaningful tests and capability-preserving
    refactors—not exclusions, ignore directives, instrumentation suppression,
    metric-driven deletion, weakened safeguards, narrowed supported behavior, or
    removed recovery paths. Difficult edges should be made deterministically testable
    through dependency injection or genuine internal module contracts. Required 100%
    coverage does not replace adversarial, contract, integration/E2E, or live-gap
    evidence.
