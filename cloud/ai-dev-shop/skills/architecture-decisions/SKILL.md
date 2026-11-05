---
name: architecture-decisions
version: 1.2.1
last_updated: 2026-10-07
description: Use when selecting architecture patterns, writing ADRs, deciding whether research is required, evaluating tradeoffs, defining module and service boundaries and testable contracts, or producing quality-attribute scorecards with explicit tradeoff reasoning.
---

# Skill: Architecture Decisions

Architecture is the set of constraints that governs how the system is built. The Software Architect Agent's job is not to pick the most technically impressive pattern, or even the pattern that best fits today's requirements — it is to pick the pattern that makes future change cheapest.

Technology moves fast. The patterns, libraries, and frameworks considered best practice today will be replaced. An architecture that locks you into today's tech stack is a liability. An architecture that makes it easy to swap a dependency, extract a service, or adopt a new approach is an asset.

For the governing adaptability rule, see principle 1 in **Principles That Always Apply** below.

There is no "best" architecture. There are only tradeoffs — and adaptability is the most important one.

## Default Architecture Heuristic

Use this as the default starting position before evaluating exceptions:

1. For most long-lived products, start with a **modular monolith** at the macro level.
2. Organize delivery around **vertical slices** or strongly owned modules rather than broad shared technical layers.
3. Apply **hexagonal boundaries** inside the slices or modules that have meaningful external I/O, provider-swappability needs, or business-critical logic that must stay framework-independent.
4. For Python services, workers, APIs, and other domain-heavy backend code, hexagonal architecture is a strong default boundary discipline.
5. For frontend applications, use a frontend-specific architecture skill rather than generic hexagonal guidance.
6. For trivial CRUD, scripts, and short-lived work, do not add ports-and-adapters unless the complexity justifies it.

This is a default, not a mandate. Override it only when the system drivers clearly justify a different macro shape.

## System Drivers

Before selecting a pattern, classify the system's primary drivers:

| Driver | Questions to Ask |
|---|---|
| **Complexity** | Is the business logic simple CRUD or rich domain rules? |
| **Scale** | Will read and write loads be symmetric or asymmetric? |
| **Coupling** | How many external systems integrate? Can they be swapped? |
| **Team shape** | One team or many? Feature ownership or layer ownership? |
| **Release cadence** | Deploy everything together or independently? |
| **Audit requirements** | Do you need a full history of state changes? |
| **Longevity** | Prototype or long-lived product? |
| **Adaptability** | How easily can this be replaced in 18 months? Does this pattern trap us in a specific library, framework, or cloud vendor? Can core business logic survive if the database engine, web framework, or messaging layer is swapped? |

## ADR Workflow

- Produce `research.md` when the spec forces a choice between libraries, frameworks, services, persistence mechanisms, messaging, or infrastructure components, or when multiple viable approaches remain open.
- Run `constitution-compliance` before final pattern selection. Unjustified `EXCEPTION` entries block the ADR.
- Evaluate every viable candidate with the Pattern Evaluation Format. Use fit
  bands instead of numeric percentages; cite the driver evidence that determines
  the band.
- Score the selected candidate with the Architecture Scorecard below. Activate optional axes only through the trigger rules and cite the activation source.
- Define module or service boundaries and explicit contracts before locking the pattern.
- For each API or event contract, assign one test approach: consumer-driven, schema validation, or integration test.
- If `system-blueprint.md` assigns data ownership, encode owner and non-owner constraints in the ADR.
- Identify parallelizable slices and sequencing constraints for `tasks.md`.
- Write `adr.md` using `<AI_DEV_SHOP_ROOT>/framework/templates/adr-template.md`. Complete Constitution Check, Research Summary, Default Heuristic Alignment, Quality Attribute Scorecard, Tradeoff Tension, Why This Won, Runner-Up Comparison, Mitigations Required, Re-evaluation Triggers, Complexity Justification, and the directory structure decision below.

## Architecture Scorecard

Use this scorecard to explain why the chosen architecture is acceptable, what it is naturally good at, what it is weak at, and what mitigations are required.

The scorecard supports the ADR. It does not replace judgment.

### Core Axes (always score)

- `modifiability` — how easily behavior can be changed or extended safely
- `modularity` — how cleanly the system is partitioned into stable, isolated boundaries
- `scalability` — how well the architecture handles growth in load, data volume, or organizational scale
- `reliability` — how well the system tolerates faults, degrades safely, and recovers
- `security` — how well the architecture supports secure boundaries, access control, secrets handling, and reduced attack surface
- `operability` — how easy the system is to deploy, monitor, debug, roll back, and run
- `cost` — total ownership cost, including infrastructure cost and operational overhead
- `testability` — how well the architecture supports unit, integration, contract, and system verification

### Optional Axes (activate only when triggered)

| Axis | Activate When |
|---|---|
| `performance` | The spec or NFRs contain explicit latency, throughput, or response-time targets |
| `data_consistency` | The design introduces distributed writes, async workflows, multiple stores, or critical invariants |
| `compliance_auditability` | The system has legal, regulatory, audit-trail, or evidentiary requirements |
| `tenant_isolation` | The product is multi-tenant or has explicit customer isolation requirements |
| `integration_complexity` | The system depends on 3+ external systems or brittle partner integrations |
| `cognitive_load` | Team experience, onboarding burden, ownership fragmentation, or operator burden is a major constraint |
| `disaster_recovery` | Explicit backup, failover, RPO, or RTO requirements exist |
| `deployment_independence` | Independent release cadence is a named system driver |

**Activation rule:** optional axes are not judgment calls. If an activation condition is present, the axis becomes required in the ADR. Cite the activation source explicitly in the scorecard row.

### Score Scale

Use `1-5` only:

- `1` — poor fit; major liability
- `2` — weak fit; significant mitigation required
- `3` — workable; meaningful tradeoffs accepted
- `4` — strong fit; only minor concerns
- `5` — excellent fit; naturally supports this quality

Do not use weighted sums or arithmetic winner logic. The scorecard is structured evidence for the final tradeoff narrative, not a calculator.

### Confidence Values

Every scored row needs one confidence value:

- `measured` — backed by prototype, benchmark, or direct evidence
- `prior_art` — backed by real team or organization experience
- `analogical` — inferred from sufficiently similar systems or proven patterns
- `assumed` — mostly judgment with weak direct evidence

If more than half of core axes are `assumed`, the ADR is too speculative. Stop and require more research before finalizing the decision.

### Required Fields Per Scored Axis

Every scored axis must include:

- `axis`
- `definition`
- `score`
- `confidence`
- `strengths`
- `weaknesses`
- `rationale`
- `assumptions`
- `review_trigger`
- `delta_vs_runner_up`

Conditional fields:

- `activation_source` — required for any optional axis
- `mitigation` — required when `score <= 2`
- `owner` — required when mitigation exists
- `enforcement` — required when mitigation exists
- `deadline_or_trigger` — required when mitigation exists

### Scorecard Guardrails

- No naked scores. Every score must include rationale.
- No generic platitudes. Explain the mechanism, not the slogan.
  - Bad: `Microservices scale better.`
  - Good: `Independent service read paths let the catalog scale separately from checkout during seasonal peaks.`
- `weaknesses` must describe a concrete failure mode or change-friction scenario.
- `rationale` must tie back to a named system driver, constraint, or requirement.
- `assumptions` must be falsifiable. State what would prove them wrong.
- Do not copy the same strengths/weaknesses text across axes. If two rows say the same thing, the analysis is too shallow.
- The selected architecture must acknowledge at least one meaningful weakness. If every axis looks perfect, the scorecard is not credible.

### Blocking Rules

A candidate cannot win if any of the following are true:

1. A critical axis is scored `1` and no explicit mitigation exists.
2. The ADR has an unjustified Constitution violation.
3. More than half of the core axes are `assumed`.
4. An optional axis tied to a hard requirement should have activated but is missing from the scorecard.

**Critical axis definition:** any core axis named in the dominant quality attributes, or any axis directly tied to a hard requirement in the spec, NFRs, blueprint, or coordinator directive.

### Required Architecture-Level Synthesis

After the per-axis scorecard, the ADR must include:

- `Overall Strengths`
- `Overall Weaknesses`
- `Tradeoff Tension`
- `Why This Won`
- `Runner-Up Comparison`
- `Mitigations Required`
- `Re-evaluation Triggers`

`Tradeoff Tension` must explicitly name the main sacrifice being accepted.

Examples:

- `We are trading deployment independence for lower operational cost.`
- `We are trading strict consistency for scale and responsiveness.`
- `We are trading modularity for delivery speed in the first release.`

### Post-Implementation Re-Score

The scorecard above is written **before the code exists**. Every row is a
prediction. Nothing in the pipeline ever checked whether the prediction held,
which meant `modularity` was scored once, at the moment the least was known
about the system, and never again.

**Owner: Observer, on its scheduled cadence.** Not Software Architect — the
party that authored the prediction does not grade it, the same custody rule the
sensors use. Observer produces a recommendation for the human; it does not
rewrite the ADR.

#### Only two axes have shipped-code evidence

This is the constraint that makes the re-score honest. Do **not** re-score all
eight — most core axes need production telemetry this harness does not collect,
and a re-scored `reliability` with no incident data would be a fresh guess
wearing the authority of a measurement.

| Axis | Re-scorable | Evidence |
|---|---|---|
| `modularity` | yes | coupling, cohesion and API surface diagnostics (below) |
| `testability` | yes | changed-code coverage, mutation score, coverage-quality trends |
| every other axis | **no** | keep the design-time score and its original confidence, unchanged |

A re-scored axis carries confidence `measured`. An axis with no evidence keeps
whatever it had — do not silently promote `assumed` to `measured` because time
passed.

#### Evidence for `modularity`

Run all three, over the module boundary the ADR actually named:

- `<AI_DEV_SHOP_ROOT>/skills/codebase-analysis/scripts/main_sequence.py` — Ca/Ce,
  instability, distance. Read against
  `references/component-coupling-metrics.md`.
- `<AI_DEV_SHOP_ROOT>/skills/codebase-analysis/scripts/cohesion.py` — whether the
  modules the ADR drew are one thing each.
- `<AI_DEV_SHOP_ROOT>/skills/codebase-analysis/scripts/api_surface.py` — with
  `--baseline` from the previous re-score, so surface **growth** is visible.
  Without a prior run there is no growth reading, only a level.

**Retain each diagnostic's raw `--json` output as its own file**, in
`<ADS_MEMORY_ROOT>/reports/observer/adr-rescore/<ADR-id>-<YYYYMMDD>/`:

```text
main-sequence.json      coupling
cohesion.json           cohesion
api-surface.json        API surface  <- this is the --baseline file
```

**One file per diagnostic, not a bundle.** `api_surface.py --baseline` reads its
own output shape and nothing else; a combined document containing all three is
rejected, so a bundled artifact would silently end the trend at the first
re-score. Pass the previous run's `api-surface.json`, and record both that path
and the directory in the memory entry.

Growth is a two-run measurement: a re-score that discards its artifacts makes
the *next* one impossible. Capture the full run — a `--top`-truncated file is
refused as a baseline.

Plus, when a `hidden` co-change pair from
`<AI_DEV_SHOP_ROOT>/harness-engineering/sensors/change-history.md` crosses a
boundary the ADR declared: that is the strongest available evidence the
partition did not hold, because it is behavioral rather than structural.

#### What a re-score may and may not do

- It **may** lower a score, raise it, or leave it. A re-score that never moves a
  number is not evidence of a good ADR; it is evidence nobody ran it.
- It **may** fire a `Re-evaluation Trigger` the ADR already declared. That is
  what those triggers were for, and until now nothing fired them.
- It **may not** retroactively block, reopen, or invalidate any merged change.
  Same rule as every scheduled sensor: this is maintenance input about the
  decision, not a gate on code that already shipped.
- It **may not** be run on a feature that has not shipped. Before code exists
  the design-time score is the only honest one.
- A dropped `modularity` score is a **prompt to reconsider**, not an instruction
  to refactor. The correct output is often "the ADR was right and the codebase
  drifted," which routes to Refactor — but it is sometimes "the ADR was wrong,"
  which routes to a new ADR, and the numbers alone cannot tell those apart.

Record the result as an **`[ADR_RE_SCORE]`** entry in `memory-store.md` per
`<AI_DEV_SHOP_ROOT>/framework/memory/memory-schema.md`. **Not `[QUALITY]`** —
that entry type scores an agent's output on `/10` dimensions and carries no ADR
id, no 1–5 architecture axis, no confidence, and no baseline-artifact field.

### Relationship To Pattern Evaluation

Keep the existing Pattern Evaluation table for cross-candidate comparison:

- `Fit Band`
- `Adaptability`
- `Evidence Basis`
- `Pros`
- `Cons`
- `Key Tradeoffs`
- `Verdict`

Use the Architecture Scorecard to explain the selected candidate in more detail. Keep `adaptability` in the Pattern Evaluation table as a cross-candidate tiebreaker instead of duplicating it as a default scorecard axis.

## Pattern Selection Guide

### The Clean Architecture Family (Hexagonal / Clean / Onion)

These are 90% the same idea: dependencies point inward, core business logic has zero external dependencies, external systems connect through interfaces (ports) with swappable implementations (adapters).

**Use when**: You need to swap external dependencies (database, payment provider, email service). Long-lived products. Strong domain rules.

**Avoid when**: Simple CRUD where the interface overhead isn't justified.

**Core principle**: Your business logic must not import from your database layer, web framework, or any third-party library. Dependency injection inverts this at the composition root.

**File**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/clean-architecture.md`, `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/hexagonal-architecture.md`

---

### Vertical Slice Architecture

Organize by feature, not by technical layer. Each feature is self-contained: its own handler, validator, and data access in one folder. Add a feature = add a folder. Delete a feature = delete the folder.

**Use when**: Large teams where each team owns features. Feature-focused delivery. Building toward microservices.

**Avoid when**: Small solo or two-person teams where slice duplication overhead isn't worth it.

**Key tradeoff**: Some logic duplication across slices is expected and acceptable. Extract shared code only when three or more slices need it (rule of three). Shared lifecycles, security-sensitive sequences, and behaviors with a named owner follow Before You Write in `<AI_DEV_SHOP_ROOT>/skills/implementation-guardrails/SKILL.md` instead.

**File**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/vertical-slice-architecture.md`

---

### Modular Monolith

A single deployable unit with strongly enforced module boundaries. Modules communicate only through their public API — never by importing internal files from another module. Start here. Extract to microservices only when you actually need independent deployment or scaling, not before.

**Use when**: Starting a new product. Small to medium teams. Proving product-market fit before optimizing for scale.

**Avoid when**: You already need independent deployment per service, or you have multiple company-external teams.

**Key tradeoff**: Simpler ops than microservices. Module boundaries in the monolith become service boundaries later — if boundaries are enforced now, extraction is straightforward.

**File**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/modular-monolith.md`

---

### CQRS (Command Query Responsibility Segregation)

Separate read and write models completely. Writes validate business rules and maintain consistency. Reads are optimized for the exact shape the UI or API needs, often denormalized.

**Use when**: Read patterns differ significantly from write patterns. Reporting-heavy systems. Complex read models that would pollute the write model.

**Avoid when**: Simple applications where read and write shapes are the same.

**Key tradeoff**: Projection lag — read models may be slightly behind write state in async implementations.

**File**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/cqrs.md`

---

### Event-Driven Architecture / Pub-Sub

Services communicate through events, not direct calls. Publishers emit events to a topic without knowing who consumes them. Subscribers react independently.

**Use when**: Multiple services need to react to the same occurrence. High throughput async workflows. You want services to be independently deployable and loosely coupled.

**Avoid when**: You need immediate consistency. Debugging complexity isn't justified by the decoupling benefit.

**Key tradeoff**: No direct call stack makes debugging harder. Eventual consistency requires explicit handling.

**File**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/event-driven-architecture.md`

---

### Event Sourcing

Store events, not state. Derive current state by replaying the event log. Every change is an immutable append to the event store.

**Use when**: Audit trails are required. Financial or compliance systems. You need to answer "what was the state at time X?" Time-travel debugging.

**Avoid when**: You only need current state and the event infrastructure cost isn't justified.

**Key tradeoff**: Storage grows unboundedly. Rebuilding state from millions of events is slow without snapshots. Usually combined with CQRS: event sourcing on the write side, projected read models on the read side.

---

### Microservices

Each service owns its own deployment, database, and release cycle. Teams deploy independently.

**Use when**: Multiple teams need independent deployment. Services have genuinely different scaling requirements. You're past product-market fit and at scale.

**Avoid when**: Starting out. Small team. Distributed systems complexity will slow you down more than it helps you.

**File**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/microservices.md`

---

### Serverless / Pipeline-Batch

**Serverless**: Bursty workloads where you pay per execution. Ops-light teams.
**Pipeline/Batch**: Offline large-scale data processing with stage isolation.

**Files**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/serverless-architecture.md`, `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/pipeline-batch-architecture.md`

---

### Repository Pattern

Abstract all data access behind a typed interface. The domain layer defines what it needs (`findById`, `save`); the infrastructure layer implements it. Domain is testable without a database; implementations are swappable.

**Use when**: Any Clean/Hexagonal/Layered architecture where domain logic must be unit-tested without a running database. Domain rules span multiple query shapes.

**Avoid when**: Simple CRUD with no domain logic; ORM already provides adequate abstraction and tests are integration-only.

**File**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/repository-pattern.md`

---

### DDD Tactical Patterns

Entity (identity-based), Value Object (value-based, immutable), Aggregate (consistency boundary with a single root), Domain Event (past-tense fact). Aggregates enforce invariants; repositories load and save them whole.

**Use when**: Complex business rules span multiple objects. State transitions must be enforced regardless of which code path runs. Long-lived product using Clean or Hexagonal architecture.

**Avoid when**: Simple CRUD with no domain rules. Prototype or throwaway code. Team unfamiliar with the concepts — poorly applied DDD is worse than a flat model.

**File**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/ddd-tactical-patterns.md`

---

### Multi-Tenant Architecture

Three isolation models: shared DB/shared schema (row-level `tenant_id`), shared DB/separate schema (schema-per-tenant), separate DB per tenant. Each trades isolation level against ops complexity and cost.

**Use when**: SaaS product serving multiple organizations where data isolation is required. Compliance requirements mandate a documented data boundary.

**Avoid when**: Single-tenant internal tool. Consumer app with individual users (not organizations). Pre-revenue prototype.

**File**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/multi-tenant-architecture.md`

---

### Caching Patterns

Cache-aside (lazy load on miss), write-through (populate on write), write-behind (async write). Choice determines consistency guarantees and failure behavior.

**Use when**: Read-heavy workloads with repeated identical queries. Expensive operations with stable results. Reducing DB connection pressure.

**Avoid when**: Data changes faster than it can be cached (near-zero hit rate). Strong consistency required on every read (financial balances, inventory). Scale has not been measured yet — profile first.

**File**: `<AI_DEV_SHOP_ROOT>/skills/design-patterns/references/caching-patterns.md`

---

## Pattern Evaluation Format

When evaluating candidate patterns, produce this table for every viable candidate before selecting one. **Do not skip patterns because they seem unlikely — score them and let the table justify the decision.**

| Pattern | Fit Band | Adaptability | Evidence Basis | Pros | Cons | Key Tradeoffs | Verdict |
|---------|----------|--------------|----------------|------|------|---------------|---------|
| Pattern A | Strong fit | High | measured / prior_art / analogical / assumed | ... | ... | ... | **SELECTED** |
| Pattern B | Viable fit | Medium | measured / prior_art / analogical / assumed | ... | ... | ... | Not selected — reason |
| Pattern C | Weak fit | Low | measured / prior_art / analogical / assumed | ... | ... | ... | Not selected — reason |

**Fit Band** — Qualitative fit against active system drivers. Use only these
values:
- `Strong fit`: satisfies the dominant drivers with manageable tradeoffs.
- `Viable fit`: satisfies the main drivers but requires meaningful mitigation.
- `Weak fit`: misses at least one important driver or creates heavy operational
  cost.
- `Rejected`: violates a hard requirement, constitution rule, or non-negotiable
  constraint.

**Adaptability** rating:
- **High**: External dependencies isolated behind interfaces; swapping a library, framework, or service touches only the adapter/infrastructure layer.
- **Medium**: Partial decoupling; migration requires changes across multiple layers but core logic is mostly protected.
- **Low**: Business logic coupled to framework, ORM, or external service; migration requires significant rework throughout the codebase.

**Tiebreaker rule**: When two patterns are in the same Fit Band, the higher
adaptability rating wins unless a hard requirement clearly rules it out.
Document this in the Verdict column.

---

## DDD Vocabulary Reference

These terms appear throughout architecture discussions. Precision matters.

**Bounded Context**: A boundary inside which terms and rules have a specific, consistent meaning. "Customer" in Sales means something different than "Customer" in Billing. Each bounded context owns its own models.

**Entity**: An object with a unique identity that persists over time. Two instances with different IDs are different entities even if all other fields match. Examples: User, Invoice, Order.

**Value Object**: An object defined entirely by its values. No identity. Two instances with the same values are equal. Immutable — operations return new instances. Examples: Money, Address, DateRange.

**Aggregate**: A cluster of entities and value objects treated as a single unit for data changes. Has one root entity (the Aggregate Root) that controls all access and enforces all invariants. You load and save aggregates whole. Examples: Order (root) + OrderItems.

**Domain Event**: An immutable record of something significant that happened. Named in past tense. Examples: InvoiceCreated, OrderShipped, PaymentFailed. Used to decouple modules.

**Repository**: An interface that hides the database from business logic. Business logic calls `findById`, `save`, `delete`. The implementation handles the SQL/MongoDB. Swap implementations without touching core code.

**Port**: An interface that defines how the application talks to the outside world.

**Adapter**: A concrete implementation of a port. Swappable without changing the port definition.

## Architecture Decision Record (ADR) Format

Every significant architecture choice must be recorded. Use `<AI_DEV_SHOP_ROOT>/framework/templates/adr-template.md` — it includes all required sections: Constitution Check, Research Summary, Context, Decision, Rationale, Pattern Evaluation, Consequences, Module/Service Boundaries, API/Event Contract Summary, Enforcement, Related Decisions, Default Heuristic Alignment, and Complexity Justification.

ADRs live in `<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/`. They are inputs to the Programmer Agent and Code Inspection Agent — architectural violations are violations of a recorded ADR.

## Directory Structure Decision (Required in Every ADR)

Every ADR must state where `__specs__` and `__tests__` live for the selected pattern before TDD or Programmer dispatch.

- Vertical Slice / DDD / Feature-based: co-locate specs and tests with the feature module.
- Layered / Clean / Hexagonal: keep specs at feature level under a top-level `specs/` folder and mirror tests under `__tests__/` by layer.
- Modular Monolith: co-locate specs and tests with the owned module.
- Microservices: each service keeps its own `__specs__/` and `__tests__/` at service root.

If the ADR omits this decision, route back to Architect before TDD.

## Principles That Always Apply

1. **Modular and reversible first.** Keep every part fixable, replaceable, and updatable as requirements change. This outranks elegance and performance; hard requirements remain binding. Treat reversal cost as a first-class criterion. Put one narrow seam at each coupling that already exists: "if this changes, how many places do I edit?" The answer must be one. Prefer additive changes beside published surfaces, then retire the old path; prefer movable configuration data over hardcoded policy where it keeps change local. Reuse proven migration mechanisms and settle shared surface shapes before concurrent work begins. Do not invent speculative extension points: replaceable does not require pluggable.
2. **Dependencies point inward.** Core business logic must not depend on databases, frameworks, or external services.
3. **Depend on interfaces, not implementations.** Every external dependency should be behind an interface so it can be swapped, mocked in tests, or replaced without touching core code.
4. **Start simple, extract when needed.** Modular monolith before microservices. CRUD before CQRS. Add complexity only when the problem actually demands it.
5. **Match pattern to problem.** Event sourcing for audit trails. CQRS for asymmetric read/write. Vertical slices for large feature teams. One pattern is not universally better.
6. **Enforce boundaries.** Module A must not import internals from Module B. Enforce this with linting, import rules, or package structure — not by trusting developers to remember.
