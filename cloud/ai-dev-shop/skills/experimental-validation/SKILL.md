---
name: experimental-validation
version: 1.0.0
last_updated: 2026-06-09
description: Run parallel subagent experiments to empirically test competing design options before committing. Spawns N configurations against adversarial prompts, scores with independent judges, and reports results as a comparison table.
---

# Skill: Experimental Validation

## When to Use

Invoked when the runtime disclosure mandate fires (`harness-engineering/runtime/experimental-validation.md`) and the user approves running the experiment. Any agent can invoke this skill — it is not restricted to the Coordinator.

Typical triggers:
- Enforcement mechanism choices (strict vs. advisory, threshold levels)
- Architecture pattern selection (2+ viable patterns with behavioral differences)
- Prompt/instruction design alternatives (measurably different agent behavior)
- Configuration tuning with observable quality impact

## When NOT to Use

- Pure style/aesthetic preferences with no measurable output difference
- Decisions the user has already made explicitly
- Trivial choices where experiment cost exceeds decision weight
- Situations requiring real integration tests (external APIs, databases, auth flows)
- Destructive actions or experiments involving secret data
- When only one option is viable after constraint analysis

## Experiment Structure

### 1. Configuration Matrix

Define 2-4 competing configurations. Each must be:
- Self-contained (can be expressed as a prompt modification or system instruction)
- Independently testable (no cross-config dependencies)
- Labeled with blind identifiers during judging (Config A, B, C)

### 2. Adversarial Prompts

Select 1-3 prompts that stress-test the behavioral difference:
- At least one prompt targeting the expected divergence point
- At least one prompt testing graceful degradation / edge cases
- Prompts should be representative of real usage, not synthetic traps

### 3. Independent Judges

Use 1-2 judge agents per experiment run:
- Judges evaluate output against a frozen rubric (defined before runs)
- Judges receive blind-labeled outputs (no config names, no ordering bias)
- Judge persona should differ from the agent that generated the options
- Score on a 0-100 scale with breakdown by rubric dimension

### 4. Frozen Rubric

Before any experiment runs, define scoring dimensions:
- Correctness / constraint satisfaction
- Clarity / actionability of output
- Robustness under edge cases
- Domain-specific criteria relevant to the decision

## Procedure

### Phase 1 — Parallel Test with Combo

1. Present the `### Empirical Validation Available` section with:
   - Options to test (brief description of each config)
   - Estimated scope (N configs + 1 combo × M prompts × K judges)
   - Ask user to approve or skip
2. On approval, construct a **combo config** before any experiment outputs exist:
   - Write a one-line hypothesis for each option's strongest apparent trait
   - Include only traits that can be expressed as config instructions
   - Preserve all hard constraints and negative constraints from viable options
   - Do not add unrelated behavior outside the tested option set
   Include the combo as an additional config alongside the stated options.
3. Spawn all experiment agents in parallel (one per config × prompt combination, including the combo)
4. Collect outputs, strip identifying information, assign blind labels
5. Dispatch judge agent(s) with rubric + blind-labeled outputs
6. Aggregate scores into comparison table

**Phase 1 exit conditions:**

Compute aggregate score as the mean across prompts, judges, and rubric dimensions (unless the frozen rubric declared weights before the run).

- If combo has the top aggregate score and is not beaten by another config on any rubric dimension by 10+ points: recommend combo, done.
- If any single option has a 10+ point aggregate lead over the next-best config: recommend winner, done.
- If top configs are within 10 points AND different options win different rubric dimensions by 5+ points: proceed to Phase 2.
- Otherwise recommend the aggregate leader with Medium confidence and note the close margin.

### Phase 2 — Data-Informed Synthesis (conditional)

Triggers only when Phase 1 shows complementary strengths across options without a clear winner.

1. Analyze Phase 1 scores: identify which option won each dimension and by how much
2. Craft a **targeted synthesis** — sharper than the Phase 1 combo because it's informed by actual scoring data (e.g., "A won grep-ability at 70, B won auditability at 80 — blend those specific traits")
3. Generate one synthesis candidate for the most diagnostic Phase 1 prompt, then judge it against the Phase 1 leader's same-prompt output using the frozen rubric (1 extra judge round, not a full re-run)
4. If the synthesis beats the leader: recommend it. If not: recommend the Phase 1 leader.

## Output Format

```markdown
### Experiment Results

| Config | Prompt | Judge Score | Breakdown |
|--------|--------|-------------|-----------|
| A      | P1     | 85/100      | correctness=90, clarity=80, robustness=85 |
| B      | P1     | 30/100      | correctness=20, clarity=50, robustness=20 |
| A      | P2     | 78/100      | correctness=80, clarity=75, robustness=80 |
| B      | P2     | 25/100      | correctness=15, clarity=45, robustness=15 |

**Winner:** Config A (avg 81.5 vs 27.5)
**Confidence:** High — consistent across prompts and dimensions
**Recommendation:** [specific recommendation based on evidence]
```

## Guardrails

- Maximum stated configs per experiment: 4 (plus 1 combo = 5 total in Phase 1)
- Maximum prompts per experiment: 3 (unless user explicitly expands)
- Maximum judges per experiment: 2 (avoid judge-committee overhead)
- Total agent spawns per experiment: ≤ 15 (5 configs × 3 prompts) + judges + 1 optional Phase 2 synthesis
- Phase 2 adds at most 1 config + 1 judge round — never a full re-run
- If estimated cost is disproportionate to decision weight, say so and suggest lighter validation
- Never auto-execute without user approval — the runtime mandate requires the offer, not the execution

## Skip-Reason Format

The required `> (skip: [reason])` format is enforced by the runtime mandate (`harness-engineering/runtime/experimental-validation.md`). Adhere to it precisely so automated audits can track skipped experiments.

## Integration Notes (v2, deferred)

- Tripwire integration: repeated option-debates without empirical evidence may flag as a quality/loop concern
- Failure-promotion: successful experiment results can be promoted into benchmark fixtures via `harness-engineering/quality/failure-promotion-policy.md`
