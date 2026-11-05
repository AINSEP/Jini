---
name: non-functional-requirements-discovery
version: 1.0.0
last_updated: 2026-05-13
description: Discover, classify, and route non-functional requirements for software projects without prescribing solutions. Uses a default-light pass with optional targeted deepening when risk signals justify it.
---

# Skill: Non-Functional Requirements Discovery

Use this skill to discover quality constraints before architecture or implementation
decisions harden. It identifies what the system must be like, how success will
be measured, which assumptions are being made, and which downstream agent owns
the unresolved work.

This skill discovers requirements. It does not select patterns, technologies,
vendors, infrastructure, indexes, caches, queues, or other candidate solutions.

## Load Strategy

Read this file for all NFR discovery runs.

- Light pass: do not read any file in `references/`.
- Deep pass: read `references/category-deepening.md` only after at least one
  documented risk signal fires or the user/Coordinator explicitly asks for
  depth. If only a few categories triggered, jump to those headings when
  practical.
- Example records: read `references/example-records.md` only when the agent
  cannot resolve output format from the schemas in this file, or when the user
  explicitly asks for examples.
- Never load both references preemptively. Each reference load must have a
  specific trigger.

## When to Use

- System Design runs the light pass for greenfield or macro-shaping work.
- Spec Agent preserves/refines an existing NFR table, or runs a compact light
  self-check when no blueprint exists.
- Software Architect may run targeted deepening when a quality-attribute axis lacks
  enough upstream detail to make an ADR decision.
- Coordinator may use it during planning discussions to keep requirements,
  assumptions, risks, and downstream owners separated.

## When Not to Use

- Do not use this as an implementation checklist.
- Do not use it to validate code-level performance, security, reliability, or
  observability. Load the relevant specialist skill for that.
- Do not run a full deep pass for small scripts, prototypes, or narrow changes
  unless the user asks or a clear risk signal exists.

## Usage Modes

This skill supports multiple usage modes. The invoking context determines which mode
and depth to use — those constraints belong to the invoker, not this skill.

| Mode | When | What It Produces |
|---|---|---|
| Light pass | Default for greenfield or macro-shaping work | Quick category classification with safe defaults |
| Compact light pass | Small features with no upstream blueprint | Minimal classification focused on blocking unknowns |
| Targeted deepening | A specific quality axis lacks upstream detail | Deep records for only the triggered categories |
| Read-only consumption | Downstream work references existing NFR records | No new discovery; apply existing records to current task |

Invokers should define their own question caps, depth limits, and pass scope
in their own configuration. This skill does not enforce per-invoker limits.

## Categories

1. Scale / Capacity
2. Performance / Latency
3. Availability / Uptime
4. Reliability / Fault Tolerance
5. Consistency / Freshness
6. Durability / Disaster Recovery
7. Security
8. Privacy
9. Data Integrity
10. Compliance / Auditability
11. Observability
12. Operability / Deployability
13. Maintainability / Evolvability
14. Cost / Resource Efficiency
15. Interoperability / External Integrations
16. Portability / Environment Constraints
17. Usability / Accessibility
18. Testability / Verifiability

## Workflow

### 1. Light Pass

Classify every category quickly. Use `Applicable`, `N/A`, or `Unknown`.
For `Unknown`, classify it as `BLOCKING`, `SAFE DEFAULT`, or `DEFERRED`.

Do not ask one question per category. Ask only questions that block responsible
downstream work. For non-blocking ambiguity, record a safe default assumption and
continue.

Unknowns involving a new dependency, domain ownership boundary, external
integration, durable data schema, migration boundary, auth/trust boundary, or
source-of-truth decision are `BLOCKING`. Do not classify those structural
architecture boundaries as `SAFE DEFAULT` or `DEFERRED` just to advance the
stage.

Question caps limit one interaction, not readiness. If there are more blocking
unknowns than the cap allows, ask the highest-risk questions first and record
the rest as `BLOCKING` with an owner. Do not relabel overflow blockers as
`SAFE DEFAULT` or `DEFERRED` just to advance the stage.

Light table schema:

| Category | Status | Summary / Assumption | Unknown Class | Downstream Owner |
|---|---|---|---|---|

### 2. Risk Signal Check

Trigger targeted deepening when one or more are true:

- The user states a hard or measurable quality target.
- The system handles regulated, sensitive, private, financial, safety-critical,
  or permission-sensitive data.
- The system has multi-tenant, cross-organization, or externally shared data.
- The workflow depends on third-party services, webhooks, batch imports/exports,
  identity providers, model providers, or other external systems.
- The design implies distributed workflows, asynchronous processing, derived
  state invalidation, eventual consistency, offline behavior, or conflict
  resolution.
- The product claims high availability, disaster recovery, data retention,
  auditability, or operational support expectations.
- The expected load, data volume, traffic shape, latency sensitivity, or growth
  rate would materially affect architecture or testing.
- A missing NFR would force Programmer, DevOps, Security, Database, QA/E2E, or
  TestRunner to invent policy.

### 3. Deep Pass

Deepen only the triggered categories. Do not deepen all categories just because
one category triggered.

Deep table schema:

| Category | Requirement / Target | Assumption | Measurement / Evidence | Risk If Missed | Priority | Unknown Class | Downstream Owner |
|---|---|---|---|---|---|---|---|

Default deep-pass question cap: ask at most 5 additional blocking questions
total, unless the user explicitly requests exhaustive discovery.

## Guardrails

- Keep functional requirements and non-functional requirements separate.
- Keep requirement discovery separate from candidate solutions.
- Do not name specific technologies, services, vendors, patterns, database
  tactics, or infrastructure tactics in this skill's outputs unless the user
  already provided them as hard constraints.
- Do not score quality attributes here. Software Architect scores tradeoffs later.
- Do not turn the category list into a questionnaire dump.
- Do not invent requirements. Mark unknowns and assumptions explicitly.
- Do not block downstream work on `SAFE DEFAULT` or `DEFERRED` unknowns; assign a
  downstream owner.
- `BLOCKING` unknowns should block only the stage that cannot proceed
  responsibly without the answer.

## Handoff Contract

Emit:

- Light-pass category table.
- Risk signals found, or `None`.
- Deep-pass records for triggered categories, if any.
- Blocking NFR unknowns, if any.
- Safe default assumptions.
- Dominant quality-attribute candidates for Software Architect, derived from the material
  NFR records, with no scores.
- Downstream owner for each unresolved or material record.
