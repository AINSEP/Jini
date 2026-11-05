---
name: advanced-frontend-architecture
version: 2.0.0
last_updated: 2026-06-23
description: Framework-agnostic frontend architecture selector and validator for Software Architect when choosing, scoring, or validating frontend code-organization paradigms and combinations across React, Angular, Vue, Svelte, or plain TypeScript. Covers framework-native conventions, DDD/domain modeling, vertical slices, Feature-Sliced Design, hexagonal frontend ports/adapters, orchestration/Orc-BASH, and the pure-core mirrored-UI article stack. Use for frontend architecture ADR selection, proposal validation, drift/conformance checks, and Architect handoff contracts; not for implementation or default agent loading without eval evidence.
---

# Skill: Advanced Frontend Architecture

Use this skill to select or validate frontend architecture. It is owned by the
Software Architect. Programmer agents consume the resulting ADR/handoff and load
the implementation skills named there; they should not use this skill to
reselect architecture during implementation.

This skill is framework-agnostic. React has richer local implementation
references in this repo, but React patterns are not defaults and must not leak
into Angular, Vue, Svelte, or plain TypeScript decisions.

## Operating Modes

### Selection Mode

Use Selection Mode when:

- No approved frontend architecture ADR exists for the project/module.
- The user asks which paradigm, folder strategy, or combination fits.
- A feature changes frontend boundaries, ownership, state placement, or import
  rules enough that local conventions are not enough.

Goal: produce an ADR-shaped recommendation and a Programmer handoff.

### Validation Mode

Use Validation Mode when:

- A frontend architecture ADR or proposal already exists.
- The user asks whether the design fits, whether code is drifting, or whether a
  proposed implementation violates the architecture.
- A reversal trigger, migration concern, or boundary violation is suspected.

Goal: decide whether the architecture still holds, has drifted, or needs a new
Selection Mode pass.

### Skip

Skip this skill when:

- The task is leaf-level implementation inside an existing convention.
- The task is copy, styling, one component, or one bug with no boundary impact.
- The concern is backend/service/worker architecture; use `system-design`,
  `hexagonal-architecture`, or `backend-implementation` instead.
- An approved ADR exists and there is no drift signal or explicit validation
  request.

## Load Strategy

Read this file first. Load references only when the mode requires them:

- `references/architecture-catalog.md`: load in Selection Mode to build the
  candidate set and understand paradigm/composition profiles.
- `references/frontend-selection-scorecard.md`: load when scoring candidates or
  choosing dimension weights.
- `references/handoff-contract.md`: load before producing the Architect to
  Programmer handoff.
- `references/frontend-implementation-patterns.md`: load only for tactical UI
  review or implementation-pattern validation. It contains React/TSX examples
  and is not part of architecture selection.

Cross-reference implementation skills only after selection:

- `skills/frontend-react-orcbash/SKILL.md`: React implementation of Orc-BASH.
- `skills/feature-slice-design/SKILL.md`: FSD implementation and import rules.
- `skills/hexagonal-architecture/SKILL.md`: general ports/adapters reference;
  adapt carefully for frontend and framework boundaries.
- `skills/design-patterns/SKILL.md`: implementation details for selected
  patterns.

## Mode Router

1. Check for an active frontend architecture ADR, governance ADR, or Coordinator
   directive.
2. If no ADR exists and the request affects architecture boundaries, run
   Selection Mode.
3. If an ADR exists and the request asks for fit, drift, conformance, migration,
   or reversal analysis, run Validation Mode.
4. If an ADR exists and the task is implementation-only, route to Programmer
   with the ADR's named implementation skills.
5. If the context is ambiguous, state the ambiguity and do the least expensive
   useful pass:
   - trivial/small CRUD: recommend framework-native conventions with a revisit
     trigger;
   - structural uncertainty: run Selection Mode.

## Selection Procedure

### Step 1: Intake

Gather only the facts needed to choose candidates:

- Goal and non-goals
- Current architecture or greenfield status
- Framework constraint: React, Angular, Vue, Svelte, multi-framework, or none
- Domain complexity and whether the frontend owns real business rules
- UI surface area, route count, and state complexity
- Team topology and ownership model
- Lifespan, migration pressure, and expected change rate
- Delivery needs: one deployable, independent deploys, or platform ownership
- Risk constraints: compliance, security, performance, budget, and timeline

If facts are missing, proceed with explicit confidence labels. Do not invent
team size, framework, performance targets, or compliance requirements.

### Step 2: Run Intake Axes

Load `references/frontend-selection-scorecard.md`.

Use the four intake axes to filter and route candidates:

- Domain complexity
- UI surface and framework diversity
- Team/ownership topology
- Lifespan and migration pressure

Use the cost gate: if the project is simple CRUD, single framework, one small
team, short-lived, and single deployable, recommend framework-native conventions
with a revisit trigger instead of running a full scorecard.

### Step 3: Build Candidate Set

Load `references/architecture-catalog.md`.

Select 2-4 composed candidates. Candidates are stacks, not isolated buzzwords:

- Runtime/rendering layer: SPA, SSG, SSR/hybrid, native framework routing.
- Topology layer: single app, modular monolith, micro-frontends.
- Data/I/O layer: direct REST/RPC, BFF, GraphQL/tRPC, server actions/loaders.
- Internal pattern layer: framework-native, DDD/domain modeling, vertical
  slices, FSD, hexagonal ports/adapters, orchestration/Orc-BASH, article stack.

Examples:

- `framework-native + route-level slices`
- `SPA + modular monolith + FSD boundaries`
- `SSR/hybrid + DDD core + vertical slices`
- `pure modules + hexagonal ports + mirrored ui/<framework> + guards`
- `React + Orc-BASH for justified orchestration/state/API seams`

Do not score BFF/GraphQL, SSR, or micro-frontends as if they were the same class
of decision as FSD or vertical slices. Compose them when relevant.

### Step 4: Score Candidates

Use the 4 intake axes plus the 8 primary deep dimensions from
`references/frontend-selection-scorecard.md`.

Default to the 8 primary dimensions. Split out extended dimensions only when a
material tradeoff would otherwise be hidden. For example, split
Rendering/Performance/Data Fetching when SSR has good initial HTML but risky
hydration or request waterfalls.

Scoring rules:

- Score 1-5 where 1 is poor fit, 3 is adequate, and 5 is excellent fit.
- Use confidence: high, medium, or low.
- Mark N/A when a dimension belongs to the host architecture rather than the
  internal pattern being compared.
- Weight by project evidence, not equal arithmetic totals.
- For high-weight dimensions, include evidence, constraint interaction,
  candidate comparison, failure mode, tradeoff, score, confidence, and missing
  information.
- For low-weight dimensions, one line is enough.
- Do not compute a weighted GPA. Use scores to expose tradeoffs and select a
  recommendation.

### Step 5: Select Decision Scope

Use scope-based depth. The level names are compatibility labels, not persona
instructions.

- Bounded (Senior/L5): one team, one release, reversible, limited migration.
- Cross-cutting (Staff/L6): multiple teams or slices, 6-18 month horizon,
  shared guardrails, or phased migration.
- Strategic (Principal/L7): org-wide standard, multi-year impact, governance,
  platform cost, or hard-to-reverse choices.
- Exploratory (Distinguished/L8+): explicit platform bet, unproven technology,
  browser/runtime ecosystem assumption, or industry-direction question.

Escalate based on decision blast radius and reversibility, not the user's title.

### Step 6: Produce Handoff

Load `references/handoff-contract.md` and emit the required Architecture Handoff.
The handoff is the boundary between Architect and Programmer. It must name the
implementation skills and the decision boundaries so Programmer does not reopen
architecture selection.

## Validation Procedure

1. Identify the ADR/proposal and selected architecture combo.
2. Extract invariants: folder map, import direction, public APIs, state
   ownership, framework assumptions, enforcement gates, and reversal triggers.
3. Compare current proposal/code evidence against those invariants.
4. Classify each finding:
   - Holds: evidence matches the ADR.
   - Drift: implementation deviates but the ADR may still be valid.
   - Reversal trigger: project facts changed enough to rerun Selection Mode.
   - Unknown: not enough evidence; name the missing evidence.
5. Recommend one of:
   - Keep ADR and fix implementation drift.
   - Amend ADR narrowly.
   - Rerun Selection Mode.
   - Route to implementation skill because the issue is tactical.

Do not turn Validation Mode into general code review. Validate architecture fit
and boundary conformance only.

## Output Format: Selection

```markdown
## Decision Context
- Status: Proposed
- Goal:
- Non-goals:
- Current architecture:
- Framework constraint:
- Team/ownership:
- Domain complexity:
- Change horizon:
- Decision scope: [Bounded | Cross-cutting | Strategic | Exploratory]
- Confidence:

## Intake Result
| Axis | Finding | Routing Effect | Confidence |
|---|---|---|---|

## Candidate Set
1. [Composed candidate] - [one-line characterization]
2. [Composed candidate] - [one-line characterization]

## Scoring Summary
| Dimension | Weight | [Candidate 1] | [Candidate 2] | Winner | Confidence |
|---|---:|---:|---:|---|---|

## Argument Chain
### [High-weight Dimension]
- Evidence:
- Constraint interaction:
- Candidate comparison:
- Failure modes:
- Tradeoff:
- Score:
- Confidence:
- Missing information:

## Decision
- Chosen approach:
- Why this won:
- Why not the alternatives:
- Preconditions:
- Follow-up decisions:
- Reversal triggers:

## Architecture Handoff
[Use references/handoff-contract.md]
```

## Output Format: Validation

```markdown
## Validation Context
- ADR/proposal reviewed:
- Selected architecture:
- Evidence reviewed:
- Validation scope:

## Invariants Checked
| Invariant | Expected | Observed | Result |
|---|---|---|---|

## Findings
| Finding | Class | Evidence | Recommended Action |
|---|---|---|---|

## Verdict
- [Holds | Drift fix required | ADR amendment required | Rerun Selection Mode]
- Rationale:
- Next assignee:
```

## Eval Gate

This skill is available for explicit architecture selection and validation.
Default embedding into Software Architect or Programmer standing context must
wait for ablation eval evidence. The eval must compare agent behavior with and
without this skill and measure architecture fit, over-engineering, false
activation, context cost, and Programmer overreach.
