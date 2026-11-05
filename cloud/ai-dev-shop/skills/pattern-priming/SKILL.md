---
name: pattern-priming
description: Use before writing production code for a new task or new layer to align on style and structure with a small seed example that the human approves.
---

# Pattern Priming

## Execution

- Identify the next layer or concern being implemented.
- Read the active ADR, pattern guidance, and relevant project conventions first.
- Apply Before You Write in `<AI_DEV_SHOP_ROOT>/skills/implementation-guardrails/SKILL.md` when choosing what the seed builds on.
- Generate one small seed example in the target style: function, component, module, adapter, or equivalent.
- Briefly explain why pattern priming is being done.
- Ask the human to confirm or correct the seed example.
- Iterate until the pattern is explicitly confirmed.
- Use the confirmed example as the style contract for similar code in the current session.
- Repeat pattern priming when the task shifts to a materially different layer or concern.

## Guardrails

- Do not skip pattern priming because the task seems small.
- Do not start production implementation before the seed example is confirmed.
- Keep the seed example narrow; do not solve the whole task during priming.
- If ADR constraints conflict with requested style, surface the conflict before proceeding.

## Output

- layer or concern primed
- seed example
- confirmation status or requested corrections
- note that the confirmed pattern governs similar code for the session

## Reference

- Preconditions:
  - there is a new implementation task or a shift into a different layer
  - relevant architecture and project conventions are available
- Decision rule:
  - repeat priming whenever style drift is likely because the context changed
- Failure path:
  - if the human does not confirm the pattern, keep iterating instead of writing production code
