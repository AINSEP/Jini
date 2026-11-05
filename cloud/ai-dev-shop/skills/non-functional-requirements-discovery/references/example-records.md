# Example Output Records

Load this file only when output shape is unclear from `SKILL.md`, or when the
user explicitly asks for examples. Do not load it during normal light-pass or
deep-pass discovery.

The examples below are intentionally generic. They show record shape, not a
recommended answer for a particular domain.

## Light Pass Shape

| Category | Status | Summary / Assumption | Unknown Class | Downstream Owner |
|---|---|---|---|---|
| Scale / Capacity | Applicable | Usage level is not yet quantified; assume modest initial load until clarified. | SAFE DEFAULT | Software Architect |
| Security | Applicable | Authenticated users can access protected data; permission rules need specification. | BLOCKING | Spec Agent |
| Observability | Applicable | Basic health and failure visibility required for production operation. | DEFERRED | DevOps Agent |
| Portability / Environment Constraints | N/A | No special runtime or hosting constraints stated. |  |  |

## Deep Pass Shape

| Category | Requirement / Target | Assumption | Measurement / Evidence | Risk If Missed | Priority | Unknown Class | Downstream Owner |
|---|---|---|---|---|---|---|---|
| Data Integrity | Critical writes must avoid duplicate or partial records. | Idempotent retry behavior is needed for externally triggered operations. | Acceptance criteria plus integration tests for duplicate submission and partial failure. | Incorrect records or user-visible inconsistency. | Critical | SAFE DEFAULT | Spec Agent |
| Availability / Uptime | Core workflow should remain usable during non-critical dependency failure. | Non-critical features may degrade while core actions continue. | E2E failure-mode checks and operational runbook evidence. | Full workflow outage from a secondary dependency. | Important | DEFERRED | Software Architect |
