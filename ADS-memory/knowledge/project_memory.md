# Project Memory

Use this file for stable project-specific conventions, constraints, gotchas, and patterns.

## Entries

- 2026-07-23: Extended Jini project information lives under `foundry/docs/`. Start with
  `foundry/docs/jini-port/START-HERE.md`, then read
  `foundry/docs/jini-port/extraction-plan.md`; use ADS-memory for retained decisions,
  evidence, reports, and curated memory rather than as a replacement for those docs.
- 2026-07-24: **Coverage integrity is a durable project rule.** Coverage targets are
  acceptance gates, not optimization targets. Reach them with behaviorally meaningful
  tests and capability-preserving refactors. Never improve a coverage result by
  suppressing instrumentation, excluding in-scope executable source, deleting
  reachable or defensive behavior solely for the metric, weakening validation or
  security controls, narrowing supported inputs or provider wire formats, or removing
  recovery and error paths. When an edge is difficult to test, make it deterministic
  through dependency injection or a real internal module contract, then test its
  observable outcome. A 100% coverage result is necessary when required, but is not
  sufficient by itself: retain adversarial, contract, integration/E2E, and live-gap
  evidence appropriate to the risk.
