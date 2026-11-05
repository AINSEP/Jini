---
name: system-blueprint
version: 1.3.0
last_updated: 2026-05-13
description: Use when shaping a project at macro level before feature specs: define the functional and non-functional models, domains/components, ownership boundaries, integration map, and spec decomposition plan.
---

# Skill: System Blueprint

This skill produces a macro-level architecture planning artifact before detailed feature specs.

## Purpose

Provide a high-level system layout so Spec Agent knows what to spec and at what granularity.

This stage exists to prevent downstream spec drift: if specs are written before macro boundaries are clear, they often encode the wrong granularity, assumptions, and ownership model. That causes rework in Software Architect/TDD/Programmer later.

- This is problem-space and system-shape planning.
- This is where generic functional discovery is modeled before specs.
- This is where generic NFR discovery is surfaced before ADR tradeoffs.
- This is not a feature-level ADR.
- This does not make binding micro-level implementation decisions.

## When to Use

Run before Spec when one or more are true:

- Multi-domain system or unclear bounded contexts.
- Unclear ownership of data or integration boundaries.
- Expected parallel team/slice delivery.
- Greenfield product with uncertain system decomposition.
- The user's product intent names features, entities, or flows but not the actor goals, resource operations, or lifecycle/rule model behind them.

## Inputs

- Product vision / vibe output / discovery notes.
- Constraints: compliance, latency, reliability, budget, timeline.
- Existing architecture context (if extending an existing system).
- CodeBase Analyzer reports (`ANALYSIS-*`, `MIGRATION-*`, `TESTABILITY-*`) when
  extending an existing system.

## Skill Loading Priority

1. Primary: this skill (`system-blueprint`) controls process and artifact shape.
2. Secondary (always): `<AI_DEV_SHOP_ROOT>/skills/non-functional-requirements-discovery/SKILL.md` for structured NFR elicitation before quality-attribute naming; load its `SKILL.md` for the light pass and keep references gated.
3. Secondary (always): `<AI_DEV_SHOP_ROOT>/skills/design-patterns/SKILL.md` for macro architecture option language and tradeoff framing.
4. Secondary (always): `<AI_DEV_SHOP_ROOT>/skills/architecture-decisions/SKILL.md` for system-driver framing (without producing ADR decisions here).
5. Conditional tertiary skills (load only when needed):
   - `sql-data-modeling` for ambiguous data ownership boundaries
   - `api-contracts` for integration-heavy domain boundaries
   - `change-management` for legacy migration planning
   - `performance-engineering` for strict NFR-driven topology decisions

## Exploration Requirement (mandatory)

Before finalizing the blueprint, run a short exploratory tradeoff discussion with the human:

1. Present 2-3 plausible macro stack directions.
2. Explain tradeoffs in plain language (delivery speed, complexity, scalability, operations, cost, team fit).
3. Ask what the user prefers or wants to avoid.
4. Reflect the chosen direction in the blueprint with rationale.

This stage should help the user learn options and choose intentionally, not receive a one-shot static output.

## Functional Discovery Requirement

Before finalizing domains, components, APIs, or data topology, produce a generic
functional model. Use it to understand what the software must do before deciding
how the system is partitioned.

For each category, mark it `Applicable`, `N/A`, or `Unknown`. Do not force every
project to fill every category. For small or narrow changes, collapse N/A
categories into one concise note.

Core categories:

1. **Actors / user types** — who uses, administers, supports, or integrates with
   the system.
2. **User goals and capabilities** — what each actor needs to accomplish.
3. **Core workflows / user journeys** — happy paths and meaningful alternate
   paths, described before APIs or data models are chosen.
4. **Resources and operations** — core nouns/resources plus operations such as
   create, view, update, delete, submit, approve, cancel, archive, search,
   import, export, assign, comment, or configure.
5. **Permissions and ownership** — only where relevant; who may act on which
   resources, who owns them, and what access boundaries matter.
6. **Resource lifecycle / state** — statuses and legal transitions for resources
   with meaningful state.
7. **Business rules and invariants** — validations, limits, uniqueness rules,
   calculations, eligibility, and always/never conditions.
8. **Error, exception, and recovery flows** — rejected inputs, unavailable
   dependencies, retries, cancellation, rollback, and user-visible failures.
9. **Communication and collaboration** — notifications, messages, comments,
   assignments, approvals, and reminders when relevant.
10. **Search, reporting, and analytics** — filtering, sorting, dashboards,
    exports, audit views, and metrics when relevant.
11. **Integrations and external dependencies** — external APIs, webhooks, batch
    imports/exports, identity providers, storage, third-party providers, or
    other systems when relevant.
12. **Admin, support, moderation, and operations** — internal tools, overrides,
    support workflows, review queues, and operational controls when relevant.
13. **Audit, history, and compliance evidence** — activity logs, change history,
    approval history, and retention evidence when relevant.
14. **Settings, preferences, and configuration** — user, workspace, organization,
    or system-level configurable behavior.
15. **Account and data lifecycle** — onboarding, invitation, suspension,
    deletion, retention, recovery, and data export when relevant.

Elicitation rules:

- Propose the likely main flows from the user's intent, then ask the human to
  correct or confirm them.
- Ask at most 5 blocking clarification questions per blueprint pass.
- The question cap controls how many questions are asked in one pass; it does
  not make additional blockers safe. If more blockers remain after the cap,
  record them in the blueprint and leave the relevant model status `BLOCKED`.
- Classify unknowns as `BLOCKING`, `SAFE DEFAULT`, or `DEFERRED`.
- For non-blocking ambiguity, record a safe default assumption and continue.
- Any unknown involving a new dependency, domain ownership boundary, external
  integration, durable data schema, migration boundary, auth/trust boundary, or
  source-of-truth decision must be `BLOCKING`. Do not use `SAFE DEFAULT` to
  bypass the question cap for structural architecture boundaries.
- Derive API/contracts and data model candidates from workflows, resources,
  operations, and rules; do not start by guessing tables/endpoints.
- If a missing functional decision would force Programmer to invent product
  policy, mark it `BLOCKING` before Spec dispatch.

## Non-Functional Discovery Requirement

Before finalizing runtime/data topology or naming dominant quality attributes,
run the light pass from
`<AI_DEV_SHOP_ROOT>/skills/non-functional-requirements-discovery/SKILL.md`.

For each NFR category, mark it `Applicable`, `N/A`, or `Unknown`. For `Unknown`,
classify it as `BLOCKING`, `SAFE DEFAULT`, or `DEFERRED`.

Discovery rules:

- Do not load NFR reference files during the light pass.
- Trigger targeted deepening only when risk signals are present or the
  user/Coordinator asks for depth.
- Ask at most 5 blocking NFR questions per blueprint pass.
- The question cap controls user load, not readiness. Overflow blocking NFR
  unknowns remain `BLOCKING` and keep the blueprint from approval until resolved
  or explicitly scoped out by the human.
- For non-blocking ambiguity, record safe default assumptions and downstream
  owners instead of pausing.
- Any unknown involving a new dependency, domain ownership boundary, external
  integration, durable data schema, migration boundary, auth/trust boundary, or
  source-of-truth decision must be `BLOCKING`. Do not use `SAFE DEFAULT` to
  bypass the question cap for structural architecture boundaries.
- Keep requirement discovery separate from candidate solutions.
- Derive dominant quality-attribute candidates from material NFR records; do
  not score them in Blueprint.
- If a missing NFR would force a downstream agent to invent policy, mark it
  `BLOCKING` before Spec dispatch.

## Required Output

Write one artifact using `<AI_DEV_SHOP_ROOT>/framework/templates/system-blueprint-template.md` to:

`<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<project-or-feature>/system-blueprint.md`

The output must include:

1. Functional discovery summary with category applicability, safe assumptions,
   and blocking unknowns.
2. NFR discovery summary with category applicability, safe assumptions, blocking
   unknowns, risk signals, and downstream owners.
3. Existing-codebase evidence summary when applicable: CodeBase Analyzer report
   paths consumed, sampled-coverage caveats, Critical/High findings that affect
   boundaries, migration/testability constraints, and reports that still need
   human review.
4. Macro components/domains and responsibilities.
5. Ownership boundaries and integration map.
6. High-level runtime/data topology.
7. Dominant quality attributes (max 3, no scores) that are derived from material NFR records and likely to govern the downstream ADR.
8. Explicit risks and unknowns.
9. A required `Core/Foundation` spec package at `P0` (shared shell/primitives that block parallel slices).
10. Critical cross-domain user journeys for QA/E2E handoff.
11. Spec decomposition plan (what spec packages to write next).
12. Dependency-aware sequencing plan so parallel slices are only used where dependencies permit.

## Spec Decomposition Policy

Default to **vertical/domain slicing** for decomposition.

- Preferred: domain-oriented spec packages (for example `auth-domain`, `checkout-domain`, `billing-domain`) that each own their relevant API/state/UI boundaries.
- Avoid horizontal decomposition (`frontend-only`, `api-only`, `database-only`) unless there is a clear, documented reason.
- If horizontal slicing is chosen, include explicit justification and expected coordination overhead in the blueprint risks section.
- Always define a `Core/Foundation` package at `P0`; domain slices must depend on it before parallel execution.
- If a slice depends on another slice's schema/API/event contract, it cannot run in the same parallel wave. Record the dependency in `Depends on` and place it in a later phase.
- If a slice needs a foreign key to another domain-owned table, the owner domain must be implemented first; the dependent slice must be sequenced after it.

## Guardrails

- Do not produce a feature-level ADR.
- Do not lock low-level implementation patterns.
- Name dominant quality attributes only; do not score them at blueprint stage.
- Use `non-functional-requirements-discovery` for NFR discovery; do not inline
  ad hoc NFR checklists or prescribe solutions during discovery.
- Keep stack direction non-binding unless a hard constraint already exists.
- `Core/Foundation` (`P0`) is a thin bootstrap layer only: shell/runtime primitives/shared clients/CI harness. Do not place feature-specific business logic or feature-owned tables in `P0`.
- Use `[OWNERSHIP UNCLEAR]` markers where needed; unresolved markers block Spec decomposition approval.
- Use `[FUNCTIONAL UNKNOWN]` markers for missing actor, workflow, resource,
  lifecycle, rule, or integration decisions. Only `BLOCKING` functional unknowns
  block Spec dispatch; `SAFE DEFAULT` and `DEFERRED` unknowns must have an
  explicit assumption or follow-up owner.
- For existing-codebase extensions, do not approve the blueprint until
  CodeBase Analyzer evidence has either been consumed or a `no_analysis_reason`
  is recorded. Critical/High migration or testability findings that affect the
  requested feature must be surfaced in the handoff to Spec and Software Architect.
- Include `Critical User Journeys (Cross-Domain)` so QA/E2E can validate slice convergence end to end.
- Do not turn functional discovery into a questionnaire dump. Keep the artifact
  proportional to the system size and risk.

## Handoff Contract

- Inputs used
- Blueprint summary
- NFR discovery summary
- Dominant quality attributes for Software Architect handoff
- Risks/open unknowns
- Recommended next assignee: Spec Agent
