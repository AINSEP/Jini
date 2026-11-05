---
name: superpowers-writing-plans
description: Use when a multi-step implementation plan needs to be written from a spec or clear requirements before coding begins.
---

# Superpowers Writing Plans

Write a plan that an implementation agent can execute without guesswork.

## Execution

- Read the spec or requirements and check whether the scope is still too broad for one plan.
- Map the files that will be created or changed and note their responsibilities.
- Break work into small, testable tasks with explicit verification steps.
- Include concrete file paths, commands, and expected outcomes.
- Review each completed plan chunk with the companion prompt.
- Save the finished plan and hand off to execution.

## Guardrails

- Do not write a plan for a scope that should first be decomposed.
- Do not use vague steps like “add validation” without concrete file and verification detail.
- Do not batch large behaviors into a single task when they can be sliced smaller.
- If a plan chunk has blocking review issues, revise it before moving on.

## Output

- implementation plan path
- task list with concrete file paths
- verification commands and expected outcomes
- execution handoff recommendation

## Reference

- Preconditions:
  - a spec or clear requirements already exist
  - planning is happening before implementation, not after
- Decision rule:
  - decompose first if the work spans multiple independent subsystems
  - keep one plan if the scope can converge as one bounded implementation
- Review prompt: [references/plan-document-reviewer-prompt.md](references/plan-document-reviewer-prompt.md)
- Examples: [references/examples.md](references/examples.md)
- Original source: [ORIGINAL.md](ORIGINAL.md)
