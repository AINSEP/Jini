---
name: superpowers-receiving-code-inspection
description: Use when receiving code review feedback before implementing changes. Guides clarification, technical verification, and pushback when feedback is wrong or incomplete.
---

# Superpowers Receiving Code Review

Handle review feedback with technical evaluation, not reflexive agreement.

## Execution

- Read all review feedback before changing anything.
- Restate or clarify unclear items before implementation.
- Verify each item against the current codebase and constraints.
- Decide whether the feedback is correct, incomplete, or wrong for this codebase.
- Implement valid items one at a time and test after each change.
- Push back plainly when feedback is technically unsound or conflicts with upstream decisions.

## Guardrails

- Do not agree performatively.
- Do not implement partially understood feedback.
- If an item is unclear, stop and ask before changing code.
- If feedback breaks existing behavior or violates YAGNI, challenge it with evidence.
- If you pushed back and were wrong, correct course plainly and continue.

## Output

- clarified feedback items or open questions
- fixes applied
- pushback decisions with rationale
- verification status after each implemented item

## Reference

- Preconditions:
  - review feedback exists
  - code changes are still under the agent's control
- Decision rule:
  - verify first if feedback comes from an external reviewer
  - clarify first if any item is ambiguous or interdependent
- Examples: [references/examples.md](references/examples.md)
- Original source: [ORIGINAL.md](ORIGINAL.md)
