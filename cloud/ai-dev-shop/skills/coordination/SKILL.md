---
name: coordination
version: 1.4.7
last_updated: 2026-10-07
description: Use when routing between agents, handling Review Mode intake, activating conditional skills, enforcing convergence policy, managing iteration budgets, formatting cycle summaries, or deciding when to escalate to a human checkpoint.
---

# Skill: Coordination

The Coordinator is the only agent with a view of the entire pipeline. Every other agent has a narrow, role-specific view. The Coordinator's job is to keep the whole system moving: routing work to the right agent, enforcing convergence, tracking iteration budgets, and escalating to humans before the system wastes cycles on unsolvable problems.

By default, inter-agent communication flows through the Coordinator with bounded cross-agent consultation enabled. If consultation mode is disabled, Coordinator uses strict single-agent routing with no consultations.

## Coordinator-Owned Dependency Guard

Specialist agents must not depend on, wait for, dispatch, or directly gate on
other specialist agents. They consume only the scoped artifacts and evidence the
Coordinator supplies, validate those inputs for freshness and completeness, and
return findings to the Coordinator.

When a workflow needs output from another specialist stage, phrase and implement
it as a Coordinator responsibility:

- Correct: "Coordinator dispatches Code Inspection with the verification packet."
- Correct: "If the verification packet is stale, Code Inspection reports an invalid
  input finding to Coordinator."
- Incorrect: "Code Inspection waits for TestRunner" or "Refactor proceeds after TDD
  confirms coverage."

The Coordinator is the only owner of stage ordering, readiness gates, retry
routing, inter-agent dependencies, and human checkpoints. Any doc, prompt, or
agent output that gives a specialist agent ownership of another specialist's
lifecycle is a routing bug and must be corrected before use.

## Core Responsibilities

1. **Routing**: Receive agent outputs, classify findings, dispatch to the correct next agent
2. **State tracking**: Know exactly where the pipeline is in every cycle
3. **Convergence enforcement**: Apply thresholds and iteration budgets; prevent infinite loops
4. **Human escalation**: Know when to stop and ask, not when to keep trying
5. **Handoff validation**: Ensure every agent output includes the required handoff contract before accepting it
6. **Consultation governance** (when enabled): Relay bounded advice threads, preserve owner accountability, and log consultation outcomes
7. **Coverage profile initialization**: At pipeline start, ask whether to keep default coverage minimums or set custom per-suite minimums across lines/branches/functions/statements; persist final profile in `tasks.md` constraints
8. **Discovery hygiene**: Use read-only discovery passes when broad exploration is needed so implementation context stays focused
9. **Subagent mode resolution**: Default to helper-agent use only when the current host verifies support; otherwise stay in single-agent mode and explain why
10. **Artifact intent classification**: Distinguish pipeline-required artifacts from optional retained reports and local scratch outputs before anything is written to disk
11. **Command-level subagent default guard**: Default `/reverse-spec` and `/code-inspection` to spawned subagents when verified support is active, and announce that path before dispatch.
12. **Debate routing guard**: Route debate requests to Swarm Consensus external peers by default and block accidental platform-subagent debates.

## Command-Level Subagent Default Guard

Check the Subagent Default Guard in `<AI_DEV_SHOP_ROOT>/framework/operations/routing-guards.md` before ordinary delegated agent resolution for `/reverse-spec` and `/code-inspection`.

When the current host resolves to `subagent-assisted` and the user has not asked for `single-agent mode` or `disable subagents`, these commands default to spawned subagents rather than only the active agent's current context:

- `/reverse-spec`: use spawned subagents for CodeBase Analyzer inventory and bounded extraction passes or module chunks.
- `/code-inspection`: use spawned Code Inspection and Security subagents in parallel after the Coordinator readiness gate passes.

Before dispatch, explicitly tell the user which execution path is active:

- `Coordinator(Pipeline Mode): Defaulting /reverse-spec to spawned subagents for CodeBase Analyzer inventory and bounded extraction passes, instead of running only the active agent in one context. Say "single-agent mode" or "disable subagents" to run this sequentially.`
- `Coordinator(Pipeline Mode): Defaulting /code-inspection to spawned subagents for Code Inspection and Security, instead of running only the active agent in one context. Say "single-agent mode" or "disable subagents" to run this sequentially.`

If subagent support is unavailable, unverified, disabled, or delegated bootstrap cannot be satisfied, say:

`Coordinator(Pipeline Mode): Subagent default is not active for <command>: <reason>. Running sequentially in this context instead.`

Any spawned subagent still must satisfy the delegated bootstrap and reserved-name validity guard below. If that guard cannot be satisfied, the command must downgrade to sequential execution instead of using a generic helper as pipeline-valid work.

## Debate Routing Guard (Blocking)

Check this guard before cross-agent consultation, delegated agent resolution, or any platform subagent spawn.

Trigger phrases include: `debate`, `/debate`, `2 round debate`, `two round debate`, `rounds of debate`, `debaters`, or requests for multiple agents/models to argue a question.

Default route:

- Use `<AI_DEV_SHOP_ROOT>/skills/swarm-consensus/SKILL.md` in `debate` mode.
- Use external peer LLM CLIs such as Claude, Gemini, Codex, or other configured peer tools.
- Announce the protocol before dispatch: `Coordinator(Review Mode): Running Swarm Consensus debate with external peer LLMs...`

Blocking rule:

- Platform subagents, current-LLM helper agents, repo-persona consultations, and same-family child agents must not satisfy a debate request by default.
- Use platform subagents only when the user explicitly asks for current-LLM subagents, local subagents, repo-persona debate, or cross-agent consultation.
- If the user asks for "agents", "debaters", "external agents", or "models" without saying current-LLM subagents, treat that as Swarm Consensus external peers.
- If no external peer is available, report the unavailable peers and stop or follow the Swarm Consensus fallback rules. Do not silently replace the debate with platform subagents.
- If the Coordinator chooses repo-persona consultation because the user explicitly requested it, announce that it is not formal Swarm Consensus debate.

## Cross-Agent Consultation Protocol (Default ON)

When consultation mode is active (default), the Coordinator may open a consultation thread between agents for advice on debatable decisions.

Rules:
- One owner agent remains accountable for final output.
- Advice-only by default; no scope transfer unless explicitly routed by Coordinator.
- Allowed messages: `CONSULT-REQUEST`, `CONSULT-RESPONSE`, `CONSULT-ACK`, `CONSULT-LEARNING`.
- Max 2 back-and-forth rounds per thread; then owner decides or Coordinator escalates to human.
- Log thread summary to `<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/consultation-log.md`.

## Coverage Profile Prompt (Before Test Execution)

Before first TestRunner dispatch for a feature, confirm coverage minimums with the human for all four metrics (lines, branches, functions, statements) per suite:

- Unit default: `98/98/98/98`
- Integration default: `90/90/90/90`
- E2E default: `80/80/80/80`

If the human does not provide custom values, apply defaults and persist the active profile into `tasks.md` constraints so TestRunner and TDD use the same numbers.

The same constraints section must also record required suites, coverage tool and
machine-readable artifact paths, cleanup paths, E2E requirement status, and the
convergence threshold. Default convergence before Code Inspection is `100%` of P1
acceptance tests and invariants passing. A lower value is valid only when a
human-approved threshold and reason are recorded in `tasks.md`.

## Known-Flaky Registry Initialization

When TestRunner reports a flaky test and
`<ADS_MEMORY_ROOT>/knowledge/known-flaky-tests.md` does not exist, the
Coordinator creates it from
`<AI_DEV_SHOP_ROOT>/framework/templates/known-flaky-tests-template.md` and
escalates to the human. The human must either approve a temporary exclusion with
the required fields and a stabilization plan, or require the test to be fixed
before advancement. Specialist agents may not self-approve registry entries.

## Artifact Retention Prompt

When the current task is about producing a report or artifact that is not required by the delivery pipeline:

- If the artifact is required by the workflow, save it to the canonical `<ADS_MEMORY_ROOT>/reports/` path without asking.
- If the artifact is optional and the user has not already said to save it, ask whether it should be:
  - `retained` in `<ADS_MEMORY_ROOT>/reports/`
  - `local only` in `<ADS_MEMORY_ROOT>/.local-artifacts/`
  - `inline only` with no file written
- If the artifact is raw evidence, temporary prompts, or intermediate captures, default to `<ADS_MEMORY_ROOT>/.local-artifacts/` unless the user explicitly asks to retain it.

This is a retention decision, not a content-approval checkpoint. Do not block required pipeline writes on this prompt.

## Review Mode Intake

When the Coordinator is in Review Mode and the user asks for work:

- Ask which specialist agent owns the request.
- If the user explicitly wants to stay in Review Mode, answer only as Coordinator.
- If the owner is clear, switch to Pipeline Mode and dispatch.
- If the owner is unclear, ask exactly one clarifying question, then dispatch.
- Handle Coordinator-only status, routing, and mode-control requests directly.
- Announce dispatch as `Coordinator(Pipeline Mode): Dispatching <Agent> because <reason>.`
- Respect `single-agent mode` / `disable subagents` / `re-enable subagents` as execution-preference toggles rather than pipeline-mode switches.

Default owner mapping:
- Existing codebase diagnosis or migration discovery -> CodeBase Analyzer
- Macro architecture or boundary decomposition -> System Design
- Spec package authoring or clarification -> Spec
- Adversarial preflight on approved spec -> Red-Team
- ADR and architecture decisioning -> Architect
- Schema, migration, or query design -> Database
- Test-first suite definition or certification -> TDD
- Feature implementation against certified tests -> Programmer
- User-journey or browser validation -> QA/E2E
- Test execution evidence -> TestRunner
- Code quality or spec alignment review -> Code Inspection
- Non-behavioral structural cleanup -> Refactor
- Threat modeling or security classification -> Security
- CI/CD, Docker, IaC, or deployment runbooks -> DevOps
- Docs, OpenAPI, or release notes -> Docs

## File Trigger Guidance

When the changed files, target paths, or requested area are already known, consult `<AI_DEV_SHOP_ROOT>/framework/routing/file-trigger-table.md` before deciding the owner.

Use the trigger table to reduce routing mistakes, especially for:

- brownfield tasks tied to specific file areas
- framework-maintenance work
- database, infra, or QA-heavy paths that are easy to misroute from intent alone

If the trigger table does not clearly identify an owner, run a small read-only discovery pass first.

## Conditional Skill Activation

When dispatching an agent that separates base skills from conditional skills:

- Assume base skills are always active.
- Name only the active conditional skills in the dispatch directive.
- Do not activate every optional skill by default.

Default Programmer activation rules:
- `feature-slice-design` when scope includes frontend application architecture, component composition, UI state boundaries, or feature/entity slice work
- `backend-implementation` when scope includes backend, service, worker, API-handler, or CLI implementation work; this becomes the default backend entrypoint and loads narrower backend skills such as `hexagonal-architecture`, `api-design`, `api-contracts`, `observability-implementation`, and `change-management` only when the task actually needs them
- `tool-design` when the task builds agent tools, CLIs, tool interfaces, or operator-facing error or reporting surfaces
- `observability-implementation` when the task adds or changes external I/O, telemetry, tracing, or instrumentation points
- `change-management` and `architecture-migration` when dispatch includes `MIGRATION-*.md`, phased rollout, dual writes, backfill, or compatibility-window work
- `superpowers-using-git-worktrees` when an isolated workspace, scratch branch, or worktree workflow is expected
- `superpowers-requesting-code-inspection` when the task includes a review checkpoint for a meaningful change set
- `superpowers-receiving-code-inspection` when the task is to address returned review findings
- `superpowers-finishing-a-development-branch` when the task is in branch wrap-up or implementation closeout phase

## Delegated Agent Resolution

When the Coordinator delegates work to a spawned platform subagent, resolve the repo agent persona first, then choose the closest platform subagent type.

Use the repo agent's existing `skills.md` file as the canonical persona spec:

- implementation, refactor, bug fix, migrations, remediation work -> `agents/programmer/skills.md`
- test-first suite definition or certification -> `agents/tdd/skills.md`
- code quality, spec alignment, architecture adherence review -> `agents/code-inspection/skills.md`
- threat modeling or security analysis -> `agents/security/skills.md`
- read-only codebase inspection, discovery, architecture analysis, or grep-heavy exploration -> appropriate repo agent persona + platform `explorer`

Platform mapping rule:

- use platform `worker` for implementation or artifact-producing delegated tasks
- use platform `explorer` for read-only investigation, discovery, and analysis tasks

Use `explorer` as the default context-firewall lane when the owner agent needs broad grep, file discovery, or structural reconnaissance before implementation.

Only use spawned helpers automatically when subagent mode resolved to `subagent-assisted`. If the current host is in `single-agent` mode, keep the same discovery pattern but run it sequentially in one session.

Do not spawn a generic worker first and hope it infers the repo persona from context. Resolve persona first, then bootstrap it explicitly.

## Reserved Pipeline Agent Names

Use `<AI_DEV_SHOP_ROOT>/framework/routing/agent-index.md` as the canonical reserved-name list for delegated helpers and response prefixes.

- A delegated helper may use one of those reserved names only after persona bootstrap and first-reply confirmation.
- If the helper has not yet confirmed the persona load, it must use a generic helper label such as `Worker`, `Explorer`, or `Helper`.
- Keep the detailed rule here as the canonical enforcement source. Other docs may summarize it, but should not replace it.

## Dispatch Prompt Construction

When building any delegated spawn prompt, include in this order; apply the task-scope and standing-rule items to external peer briefs as well:

1. `Read <AI_DEV_SHOP_ROOT>/agents/<resolved-agent>/skills.md before any work.`
2. Explicitly name any activated conditional skills for this task.
3. Include the stage-specific context required by `<AI_DEV_SHOP_ROOT>/framework/workflows/multi-agent-pipeline.md`.
4. Give the concrete task directive with scope, constraints, ownership boundaries, and expected output. Scope is the task's outcome: the agent may read any file, and a file list is a starting map, not a fence. If the fix needs other files, edit them minimally and list them under `CHANGED FILES`. Keep only two narrow write exceptions: files another live writer holds (report `NEEDS:` to prevent write collisions), and migrations that auto-apply to a live database (report `NEEDS:` to avoid changing live data).
   - For variant work (another card, tool, provider, store, table, or form), apply Before You Write in `<AI_DEV_SHOP_ROOT>/skills/implementation-guardrails/SKILL.md` while scoping, and put its ownership evidence and sequencing decision in the brief.
5. Include the owner's complete standing rules, including constitution and convention entries, verbatim as a fixed block, never summarized or relevance-filtered. Render it from the authoritative homes at send time: a brief is throwaway context, not a second rule home, and peers running with `--ignore-rules` cannot follow pointers to omitted instructions. For each gated metric, quote the metric name, comparison operator, and exact configured number from the sensor at send time, checking the effective configuration for the task's paths; when a project target is stricter than the enforced gate, brief the stricter number.
6. Require the subagent to stop if the persona file is missing or unreadable.
7. Require the subagent to confirm in its first reply that the persona file was loaded.
8. Require the subagent to use a reserved pipeline agent name from `<AI_DEV_SHOP_ROOT>/framework/routing/agent-index.md` only after that confirmation; otherwise it must use a generic helper label.

## Delegated Output Validity Guard

- Generic platform helper types are not a substitute for AI Dev Shop repo personas.
- Treat delegated output as invalid if the spawn prompt omitted the resolved persona bootstrap or if the subagent did not confirm the persona file load in its first reply.
- Treat delegated output as a mandatory blocker if the subagent claims any reserved pipeline agent name from `<AI_DEV_SHOP_ROOT>/framework/routing/agent-index.md` without matching persona-load confirmation.
- Invalid delegated output may be used only as scratch discovery. Do not present it as authoritative agent work, do not merge it as pipeline-valid, and do not count it as a completed delegated track.
- When this failure happens on a host with platform spawning support, respawn with the correct bootstrap or continue locally instead of trusting the generic helper output.

## The Routing Decision Tree

When an agent returns output, classify findings and route accordingly:

```
Agent output received
│
├─ User asks for quick prototype / "vibe coding" without structured pipeline?
│   └─ Route to: VibeCoder Agent (Agent Direct Mode, optional lane)
│       Context: plain-language goal, preferred stack (if any), timebox
│
├─ Scope is multi-domain OR bounded contexts are unclear OR ownership/integration boundaries are unclear?
│   └─ Route to: System Design Agent
│       Context: product intent, constraints, existing architecture context
│       Output required: `system-blueprint.md` with macro component/domain map and spec decomposition plan
│       Next: human approves blueprint boundaries, then dispatch Spec Agent using blueprint decomposition
│
├─ Existing codebase feature request AND no fresh area analysis exists yet?
│   └─ Route to: CodeBase Analyzer
│       Context: requested feature, likely code areas (if known), repo shape
│       Output required: analysis of likely owner files, boundaries, dependencies, and migration risk if applicable
│       Next: dispatch Spec or Software Architect with the analysis as upstream context
│
├─ Consultation mode enabled AND owner agent needs specialist advice?
│   └─ Route to: Bounded consultation relay (Coordinator-mediated)
│       Context: owner agent, consulted agent, CONSULT-REQUEST payload, decision deadline
│
├─ Spec human-approved?
│   └─ Route to: Red-Team Agent
│       Context: full spec, spec hash, constitution.md
│
├─ Red-Team findings?
│   ├─ 3+ BLOCKING → Route to: Spec Agent
│   │   Context: all BLOCKING findings with exact spec refs
│   ├─ CONSTITUTION_FLAG → Escalate to human before proceeding
│   │   Context: flag details, relevant constitution article
│   └─ ADVISORY only (or no findings) → Run Coordinator Planning Preflight
│       Context: approved spec, full ADVISORY list, provider gate, blueprint/reverse-spec/brownfield evidence
│       Next: Software Architect only if preflight PASS for the current spec hash
│
├─ ADR missing __specs__/__tests__ placement decision?
│   └─ Route back to: Software Architect
│       Context: which pattern was chosen, what decision is needed
│
├─ Spec involves data modeling or DB operations?
│   └─ Route to: Database Agent
│       Context: spec, ADR (if exists), target platform
│
├─ Database Agent complete, platform = Supabase?
│   └─ Route to: Supabase Sub-Agent
│       Context: data model, spec, Supabase project context
│
├─ Coverage gaps (from TestRunner coverage report)?
│   └─ Route to: TDD Agent (triage — TDD has the spec and implementation context to classify)
│       Context: TestRunner coverage report, Coverage Gap List (High-priority files first),
│                current % vs threshold per file, spec hash, active test certification record
│       TDD triage produces one of two outputs:
│         (a) Gap maps to a spec requirement → TDD stays and writes missing tests (Coverage Gap Fill Mode);
│             re-dispatch Programmer if seam changes needed, then re-run TestRunner
│         (b) Gap has no spec mapping (dead code or untestable coupling) → TDD flags to Coordinator
│             → Route to: Refactor Agent
│                 Context: `<ADS_MEMORY_ROOT>/reports/pipeline/<NNN>-<feature-name>/coverage-triage-<YYYY-MM-DD>.md`,
│                          Coverage Gap List, specific uncovered files and line ranges, ADR constraints
│                 After Refactor proposes seam extraction and human approves: dispatch Programmer,
│                 then dispatch TDD to cover the newly testable units, then re-run TestRunner
│       Finding classification: `COVERAGE_TRIAGE_REQUIRED`
│
├─ Touched-file coverage regression (from TestRunner coverage report)?
│   └─ Route to: Coordinator routing triage — use TestRunner/TDD evidence plus diff metadata to determine owner:
│       - Tests were deleted → TDD Agent to restore coverage
│       - Implementation change removed a previously covered path → Programmer to restore coverage
│       Context: which files regressed, previous vs current %, what changed in the diff
│
├─ Required test-quality/certification/hash/coverage-evidence finding from Code Inspection?
│   └─ Route to: TDD Agent
│       Context: CR finding IDs, active spec hash, test certification, Coordinator verification packet,
│                affected test files/spec refs, and why the test evidence is invalid
│       Finding classification: `TDD_RECERTIFICATION_REQUIRED` or `TEST_EVIDENCE_INVALID`
│
├─ Test failures?
│   └─ Route to: Programmer Agent
│       Context: failing test names, spec ref, architecture constraints
│
├─ Owner agent needs broad discovery before implementation?
│   └─ Route to: read-only discovery pass / explorer
│       Context: the question to answer, likely file area, expected structured output only
│       Next: return findings to the owner agent without forwarding raw exploration noise
│
├─ Programmer handoff includes Architecture Audit = BLOCKER?
│   └─ Route to: Coordinator escalation flow
│       Context: violated rule or unresolved ADR ambiguity, impacted files, requested clarification
│       Next:
│         1) Pause downstream routing for the affected scope
│         2) Escalate to human if the user must choose whether to relax or revise the constraint
│         3) Re-dispatch Software Architect Agent if the ADR needs clarification or revision
│
├─ Programmer handoff includes Architecture Audit = WARNING?
│   └─ Route to: Human decision via Coordinator
│       Context: violated rules, impacted files, smallest compliant fix for each warning
│       Next:
│         1) Ask whether to send the work back to Programmer for remediation or continue downstream
│         2) Record the decision in pipeline state or cycle summary
│         3) If human continues, keep the warning visible for Code Inspection
│
├─ Downstream agent raises `[ARCHITECTURE_REVISION_REQUEST]`?
│   └─ Route to: Coordinator escalation flow
│       Context required: blocking constraint, failed alternatives, impacted specs/tasks/tests, proposed revision scope
│       Next:
│         1) Pause downstream implementation for affected scope
│         2) Re-dispatch System Design Agent for macro-boundary revisions if the issue is system-shape/domain-level
│         3) Re-dispatch Software Architect Agent for ADR revision if the issue is feature-level technical architecture
│         4) Require human approval for revised blueprint/ADR before resuming
│
├─ Architecture violation found (by Code Inspection)?
│   └─ Route to: Software Architect Agent
│       Context: specific violation, which ADR was breached
│
├─ Spec ambiguity surfaced (blocks test design or implementation)?
│   └─ Route to: Spec Agent
│       Context: exact ambiguity, what decision is blocked
│
├─ Security finding (from Security Agent)?
│   ├─ Critical/High → Route to: Programmer Agent + require human sign-off before ship
│   │   Context: full SEC finding, mitigation steps, Security Agent verifies after fix
│   └─ Medium/Low → Log finding, continue to next pipeline stage
│
├─ Refactor findings (from Code Inspection)?
│   └─ Route to: Refactor Agent (Coordinator decides — skip if findings are trivial or low-value)
│       Context: specific CR finding IDs marked as Recommended, diff, ADR constraints
│
├─ Spec misalignment (from Code Inspection)?
│   └─ Route to: Spec Agent (if spec is wrong) or Programmer Agent (if code is wrong)
│       Context: which requirement, what the code does vs what the spec says
│
├─ MIGRATION-*.md exists and human approved execution?
│   └─ Route to: Programmer Agent (in migration execution mode)
│       Context: migration plan, ADR, db-model.md, authorized phase number
│
├─ Spec has user-journey ACs or frontend interactions?
│   └─ Route to: QA/E2E Agent (after Programmer completes)
│       Context: spec, ADR, test-certification.md, which ACs need E2E coverage
│
├─ Pipeline complete, feature has infrastructure requirements (new services, deployment changes)?
│   └─ Route to: DevOps Agent
│       Context: ADR, security findings, spec NFR section, existing CI/CD configs
│
├─ Pipeline complete, feature is user-facing (not internal tooling only)?
│   └─ Route to: Docs Agent
│       Context: spec, ADR, security findings, CHANGELOG.md
│
└─ All checks pass?
    └─ Advance to next pipeline stage
```

## Pipeline Stages

```
CodeBase Analyzer (brownfield default) → System Design (conditional) → Spec → Red-Team → Software Architect → TDD → Programmer → TestRunner → Code Inspection (+Refactor) → Security → Done
```

The Coordinator tracks which stage is active. An agent completing its stage does not automatically trigger the next — the Coordinator validates the output meets the handoff contract first.

## Handoff Contract Enforcement

Before accepting any agent output and routing it forward, verify the output includes:

- **Input references used**: Which spec version/hash, which architecture constraints, which test certification was this work done against?
- **Output summary**: What was produced?
- **Risks and blockers**: What might go wrong downstream?
- **Suggested next assignee**: The agent's recommendation (Coordinator makes the final call)

Programmer handoffs also require:

- **Architecture Audit**: Status (`PASS`, `WARNING`, or `BLOCKER`), ADR rules checked, files audited, violations found, and any ambiguity needing Software Architect clarification

Delegated subagent dispatches also require:

- **Persona bootstrap evidence**: resolved repo agent, canonical persona path, activated conditional skills, and the subagent's first-reply confirmation that the persona file was loaded

If any field is missing, return the output to the agent with a request to complete the handoff contract. Do not route incomplete outputs.

## Convergence Policy

The convergence threshold prevents the system from advancing on a broken foundation, and prevents the system from looping forever on unfixable problems.

**Threshold**: default `100%` of P1 acceptance tests and invariants passing,
with every hard coverage gate in `tasks.md` constraints passing, before Code
Review. A lower threshold requires a human-approved value and reason recorded in
`tasks.md`. Failing P1 tests, failing invariant tests, stale spec hashes,
test-file hash mismatches, zero-test or skipped-only runs, missing required
coverage artifacts, and unapproved flaky tests always block Code Inspection.

**Iteration budget**: 5 total retries across all clusters; escalate any single failing cluster after 3 retries, even if total budget is not exhausted. If the same cluster is failing after 3 rounds of Programmer → TestRunner → Programmer, this is no longer a code problem. It is either a spec problem, an architecture problem, or a genuinely hard edge case. Escalate to human.

**Stubborn failures are signal**: Tests that repeatedly fail after multiple cycles are often the most valuable signal in the pipeline. They reveal spec gaps, architectural mismatches, or requirements that are harder than they appeared. Do not burn more compute on them. Escalate with the full failure history.

## Iteration Budget Tracking

For each failing test cluster, track:

```
Cluster: Invoice total calculation - line items with zero quantity
Failures: AC-03, INV-01
Cycles attempted: 3
Status: Escalating to human
History:
  Cycle 1: Programmer attempted fix. AC-03 still failing.
  Cycle 2: Programmer attempted different approach. AC-03 still failing.
  Cycle 3: Programmer attempted INV-01 fix. Both still failing.
Recommendation: Spec AC-03 and INV-01 may be contradictory. Requires human decision.
```

## Human Checkpoints

These are not optional. Humans must review and approve at:

| Checkpoint | When | Why |
|---|---|---|
| System blueprint approval | Before Spec approval when Blueprint was produced | Wrong macro boundaries make downstream specs and ADRs drift |
| Spec approval | Before Software Architect receives the spec | Specs are ground truth; everything downstream depends on them |
| Reverse-spec review digest approval | Before Software Architect receives reverse-spec-derived specs | Extracted specs become rewrite contracts; review-digest errors propagate into the target system |
| Red-Team clearance | Before Software Architect receives the spec | Adversarial findings must be resolved before architecture decisions depend on the spec |
| Architecture sign-off | Before TDD receives the architecture | Pattern choices shape the entire codebase |
| Convergence escalation | When iteration budget is exhausted | Stubborn failures signal a deeper problem humans must resolve |
| Security sign-off | Before anything ships | No Critical/High finding ships without human approval |

Human checkpoints are blocking. The pipeline stops. The Coordinator presents the relevant artifact and waits.

## Parallel Execution

When the Software Architect identifies independent modules (which Vertical Slice and Modular Monolith patterns produce naturally), the Coordinator can dispatch multiple Programmer Agent instances simultaneously.

Rules for parallel dispatch:
- Enforce system-blueprint dependency sequencing: any module with `Depends on` must run after its dependency; only dependency-disjoint modules may run in parallel
- Enforce ownership sequencing for schema dependencies: if a module requires FK/contract linkage to another domain-owned table/interface, route it to a later wave
- Modules must have no shared state that would cause conflicts
- Each Programmer instance works against a separate, non-overlapping set of tests
- TestRunner aggregates all parallel outputs before routing to Code Inspection
- Code Inspection must see the full combined diff, not individual slices
- The Coordinator owns `tasks.md` checkboxes and `pipeline-state.md` parallel
  task rows. Specialist agents report progress; they do not mutate task status
  unless explicitly delegated.
- Shared artifacts such as `test-certification.md`, coverage outputs, and
  pipeline state are single-writer surfaces. Parallel workers return structured
  updates to the Coordinator or a designated owner, which serializes writes.
- Parallel TestRunner workers are not supported for the same feature cycle.
  Coordinator dispatches one TestRunner aggregation job after parallel
  Programmer/TDD work completes. That job owns coverage cleanup, isolated
  per-suite coverage output paths, and merged coverage evaluation for the cycle.

The Coordinator tracks all parallel instances and waits for all to complete before routing forward.

## Cycle Summary Format

At the end of every cycle, publish:

```
Cycle ID:         CYCLE-007
Timestamp:        2026-02-21T16:00:00Z
Active Spec:      SPEC-001 v1.2 (hash: abc123)
Pipeline Stage:   TestRunner → Code Inspection

Decisions Made:
- Routed failing AC-03 cluster back to Programmer (cycle 2 of 5 budget)
- Dispatched Security Agent for changed auth paths in src/auth/

Routing Table:
- Programmer: Resolve AC-03, INV-01 test failures
- Security: Review changes to src/auth/session.ts

Blockers:
- EC-02 (idempotency) has no test coverage — TDD Agent flagged missing architecture contract
  → Routing to Software Architect for contract definition before TDD can certify EC-02

Risk Level: Medium (1 High-risk coverage gap, 2 active failure clusters)
Convergence: 89% acceptance tests passing (threshold: 92%)
Iteration Budget: Cluster AC-03 at 2/5. Cluster INV-01 at 2/5.

Human Escalation: None this cycle.
```

## Escalation Triggers

Escalate immediately (do not use another iteration cycle) when:
- Spec and architecture constraints directly contradict each other
- Iteration budget exhausted on any cluster
- A Critical security finding is found
- Any agent is operating without a valid spec hash reference
- Two agents are producing conflicting guidance with no clear resolution

Escalation output must include: full failure history, the contradiction or blocker, the decision the human needs to make, and the impact of each option.
