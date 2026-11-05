---
name: superpowers-requesting-code-inspection
description: Use when completed work should be reviewed before continuing or merging. Prepares a focused review request with scope, git range, and requirements context.
---

# Superpowers Requesting Code Review

Ask for review with enough context to get useful findings back.

## Execution

- Identify what was implemented and what requirements or plan it should satisfy.
- Capture the review range with a base SHA and head SHA.
- Prepare a focused review request with scope, requirements, and a short summary.
- Dispatch the review using the companion prompt.
- Apply valid findings before moving on or merging.

## Guardrails

- Do not request review with vague scope.
- Do not skip important unfixed findings and continue as if the review passed.
- If the review context is incomplete, fix the request before re-dispatching it.
- If feedback is wrong, challenge it with evidence instead of ignoring it silently.

## Output

- review scope
- base and head SHAs
- review request payload
- disposition of returned findings

## Reference

- Preconditions:
  - there is a meaningful change set to review
  - requirements, spec, or plan context exists
- Decision rule:
  - request review after major tasks, before merge, or when stuck on a complex change
  - skip only if there is no meaningful change set yet
- Review prompt: [references/code-reviewer.md](references/code-reviewer.md)
- Examples: [references/examples.md](references/examples.md)
- Original source: [ORIGINAL.md](ORIGINAL.md)
