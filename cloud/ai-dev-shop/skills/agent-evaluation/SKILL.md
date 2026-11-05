---
name: agent-evaluation
version: 1.0.0
last_updated: 2026-02-22
description: Use when evaluating agent output quality, implementing LLM-as-judge, creating scoring rubrics, measuring pipeline performance, or comparing agent responses pairwise.
---

# Skill: Agent Evaluation

Evaluating agent outputs is fundamentally different from evaluating traditional software. Agents are non-deterministic — two correct outputs for the same input can look completely different. Step-by-step evaluation (did the agent take the expected path?) is wrong. Outcome-focused evaluation (did the agent produce the correct result?) is right.

## Why Agent Evaluation Is Hard

**Non-determinism**: The same agent, same input, same task can produce different correct outputs across runs. An evaluation framework that expects exact string matches will produce false failures.

**Multiple valid paths**: Invoice creation implemented correctly via Clean Architecture and correctly via Vertical Slice look completely different. Both are right. The evaluator must assess the outcome (does the code satisfy the spec?), not the form.

**80/10/5 rule**: Empirically, 80% of agent performance variance comes from token budget and context quality, 10% from tool design, and 5% from model choice. Evaluation that only measures model output quality misses the primary levers.

**Self-evaluation bias**: Agents asked to evaluate their own outputs have significant self-enhancement bias — they rate their own outputs higher than human judges do. Never use self-evaluation as the sole quality signal.

## Evaluation Taxonomy

### Direct Scoring

Score an agent output against a rubric on multiple dimensions.

Use when: you have a well-defined rubric, outputs are independent, and scale matters (evaluating many outputs).

```
Evaluator: Score this Programmer Agent output on these dimensions (1-5):

1. Spec alignment: Does the implementation satisfy all acceptance criteria in SPEC-001 v1.2?
2. Architecture compliance: Does it follow the patterns defined in ADR-003?
3. Test coverage: Do the associated tests cover all acceptance criteria?
4. Code quality: Does it follow project conventions in project_memory.md?
5. Edge case handling: Does it handle the edge cases defined in the spec?

Score each 1-5 with justification. Mark anything below 3 as a Required finding.
```

### Pairwise Comparison

Given two agent outputs, which is better?

Use when: you need to rank outputs or calibrate against a known-good baseline. More reliable than direct scoring for subtle quality differences — it is easier to compare than to score in absolute terms.

```
Compare Output A and Output B:
- Which better satisfies the acceptance criteria?
- Which has fewer architecture violations?
- Which would be easier to extend?
Choose A or B and justify each dimension. Avoid ties.
```

**Position bias mitigation**: The first option in a pairwise comparison is selected more often regardless of quality. Run each comparison twice with A/B order swapped. If results disagree, use a tiebreaker run or escalate to human.

## Multi-Dimensional Rubric Design

Single-dimension evaluation (just "is it correct?") misses systemic issues. Use rubrics with independent dimensions.

**For Programmer Agent output:**

| Dimension | What to Assess | Weight |
|---|---|---|
| Spec alignment | All acceptance criteria satisfied; no unspecified behavior added | High |
| Architecture compliance | ADR decisions respected; dependency direction correct | High |
| Test coverage | Tests cover all ACs; tests are behavior-level not implementation-level | High |
| Project conventions | Naming, structure, patterns match project_memory.md | Medium |
| Edge case handling | Spec edge cases handled per specification | Medium |
| No scope creep | No features beyond what the spec requires | Medium |

**For TDD Agent output:**

| Dimension | What to Assess |
|---|---|
| Requirement traceability | Every test maps to a specific AC or INV |
| Behavior not implementation | Tests assert outcomes, not internal structure |
| Edge case coverage | All spec edge cases have tests |
| Idempotency | Tests produce same result on repeat runs |
| Independence | Tests do not depend on each other's state |

**For Software Architect Agent output:**

| Dimension | What to Assess |
|---|---|
| Pattern fit | Selected pattern matches system drivers |
| Boundary clarity | Module/service boundaries are unambiguous |
| ADR completeness | Decision, rationale, consequences all documented |
| Parallel delivery plan | Slices are genuinely independent |

## LLM-as-Judge Implementation

When using a model to evaluate agent outputs, follow these guidelines to get reliable scores:

**Always require chain-of-thought**: `Before giving your score, reason through each dimension explicitly.` This improves reliability by 15-25% compared to direct scoring.

**Anchor rubric dimensions to artifacts**: "Does it satisfy the spec?" is vague. "Does it implement REQ-01, REQ-02, and REQ-03 as written in SPEC-001 v1.2?" is evaluable.

**Use consistent rating scales**: 1-5 with anchor descriptions at 1, 3, and 5. Avoid even-numbered scales (forces evaluator off the fence) and scales wider than 5 (calibration degrades).

```
Rating anchors:
1 = Fails this dimension entirely
3 = Partially satisfies; notable gaps
5 = Fully satisfies; no meaningful gaps
```

**Include the ground truth**: Evaluators cannot assess spec alignment without the spec. Always include the relevant spec, ADR, or reference document.

## Handling Non-Determinism

For non-deterministic agent outputs, use statistical evaluation:

1. Run the agent N times (N ≥ 5 for statistical significance)
2. Score each output independently
3. Report: mean score, variance, and rate of outputs scoring above threshold
4. A high-variance score signals an unstable agent — the input/context needs redesign, not the model

A low score in isolation is less informative than a consistently low score across multiple runs.

## Bias Landscape

Awareness of systematic biases in LLM-as-judge evaluation:

| Bias | Description | Mitigation |
|---|---|---|
| Position bias | First option in pairwise preferred | Swap A/B order and compare results |
| Length bias | Longer outputs rated higher regardless of quality | Normalize evaluation to content, not length |
| Self-enhancement | Models prefer outputs similar to their own style | Use a different model as judge than as agent |
| Authority bias | Confident tone rated higher than equivalent hedged tone | Anchor rubric to factual criteria, not style |
| Verbosity bias | More detailed justification rated higher | Require specific factual criteria checks |

## Agent Isolation Evals (Seeded Testing)

For testing individual agents in isolation with planted defects, use the **Agent Isolation Eval Framework** at `<AI_DEV_SHOP_ROOT>/harness-engineering/quality/agent-isolation-eval-framework.md`.

Isolation evals differ from the pipeline evaluation checkpoints below. Pipeline evals measure end-to-end quality; isolation evals measure each agent's independent capability by giving it controlled inputs with hidden defects and scoring what it catches.

Key resources:
- `harness-engineering/quality/agent-isolation-eval-framework.md` — repeatable harness for any agent, with agent-specific eval designs
- `harness-engineering/quality/eval-coverage-model.md` — canonical bug taxonomy, seed structure taxonomy, control-pack requirements, and benchmark status labels
- `harness-engineering/quality/function-quality-seeded-evals.md` — the original Programmer/CR seeded eval protocol (seed matrix, project types, scoring rules)
- `harness-engineering/quality/templates/` — machine-readable TSV templates for coverage matrices, seed catalogs, and run results
- `harness-engineering/validators/validate_eval_suite.py` — validator for seeded eval suites; use it before treating a suite as benchmark-grade; emits a computed status label (exploratory/pilot/benchmark/stable benchmark)
- `harness-engineering/quality/scripts/score_eval_suite.py` — scorer that computes all required suite-level metrics from `seed-catalog.tsv` + `run-results.tsv`: per-seed catch rate, breakdowns by dimension/bug-nature/structure/difficulty, false-positive rate, severity accuracy, cross-dimension stability (attention-budget regression detection), and status label
- `harness-engineering/agent-evals/` — committed canonical eval suites, with suite-local manifests, results, reports, and retained runs when present

Use isolation evals when onboarding a new agent, after applying guard promotions, or when pipeline evals show high combined scores but you suspect one agent is carrying another.

Default execution rule for isolation evals:

- run the matching repo persona first
- prefer `repo_persona_subagent` when helper-agent support exists
- use `repo_persona_host` only when subagents are unavailable or intentionally disabled
- use external CLI peers such as Claude, Gemini, or Codex CLI only when the user explicitly asks for a comparison run

Do not treat an external-peer comparison run as the default capability benchmark for the repo agent unless the user explicitly chose that protocol.

Do not treat a small seeded suite as a stable benchmark unless it has:

- an explicit coverage matrix
- positive, negative, and regression controls
- saved run results across at least 3 runs after the last framework change
- validator pass for the suite metadata and run completeness

## Pipeline Integration: Where to Evaluate

In the multi-agent pipeline, evaluation occurs at these checkpoints:

| Checkpoint | Evaluator | What is Evaluated |
|---|---|---|
| Post-TDD | Coordinator + human | Test coverage of spec requirements |
| Post-Programmer | TestRunner (automated) | Pass rate against certified tests |
| Post-Code Inspection | Coordinator | Finding severity and count trends |
| Post-Security | Human required | No Critical/High finding ships unevaluated |
| End-of-cycle | Observer | Cross-cycle quality trends |

The Observer agent is the designated cross-cycle evaluator — it accumulates scores over time and surfaces patterns (e.g., "Programmer Agent consistently misses EC edge cases" or "Code Inspection Agent consistently flags the same architecture violation").

## Common Failure Modes

**Evaluating process, not outcome**: "The agent followed the right steps" is not a quality signal. "The output satisfies the spec" is.

**No rubric, just vibes**: "This looks good" as an evaluation criterion. The same evaluator will rate the same output differently on different days. Rubrics make evaluation reproducible.

**Spec not included in evaluation context**: Asking whether code satisfies the spec without giving the evaluator the spec. The evaluator hallucinates what the spec probably says.

**Single-dimension evaluation**: Passing all tests does not mean the architecture is sound. Scoring only test pass rate misses architecture violations, security issues, and spec alignment failures. Use multi-dimensional rubrics.

**Evaluating first output only**: On a non-deterministic task, the first output may be an outlier. Evaluate a sample of outputs for important decisions.
