# Enterprise Spec Reference: Closed-Loop Feedback

Post-ship defects are structured feedback events, not ad hoc patches.

## Gap Categories

### Intent-to-Spec Gap

The user scenario was real, but the spec failed to describe it.

Fix path:

1. update spec
2. version and re-hash
3. route to TDD for missing test
4. route to Programmer for implementation

### Spec-to-Implementation Gap

The spec was correct, but code diverged.

Fix path:

1. route to TDD if test is missing
2. route to Programmer with failing test or regression
3. bring implementation back into alignment with spec

## learnings.md Entry Format

```text
[FAILURE] <ISO-8601 date> | Gap type: intent-to-spec | spec-to-implementation
Spec: <SPEC-ID and version>
Symptom: <user-visible failure>
Root cause: <missing spec coverage or implementation divergence>
Fix applied: <spec/test/code route taken>
Harness improvement: <if applicable>
```

## Harness Improvement Threshold

When the same class of defect recurs twice, it should become a harness rule:

- identify the agent skill that needs the new rule
- draft the constraint
- present for approval
- add the rule and reference the improvement in learnings
