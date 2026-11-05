---
name: superpowers-dispatching-parallel-agents
description: Use when there are multiple independent work items or failure clusters that can be investigated in parallel without shared-state conflicts.
---

# Superpowers Dispatching Parallel Agents

Split independent work into parallel tracks only when independence is real.

## Execution

- Group the work into independent domains.
- Confirm the domains do not require shared state or ordered execution.
- Prepare one focused task per domain with scope, goal, constraints, and expected output.
- Resolve the repo agent persona for each parallel track before spawning the platform subagent.
- In every parallel spawn prompt, instruct the subagent to read `<AI_DEV_SHOP_ROOT>/agents/<resolved-agent>/skills.md` before any work.
- Include any activated conditional skills and the required stage context in every parallel spawn prompt.
- Dispatch the work in parallel.
- Review the returned outputs for overlap or conflict.
- Re-run the integration check or full verification after combining the results.

## Guardrails

- Do not parallelize related failures just to go faster.
- Do not dispatch multiple agents into the same files without explicit coordination.
- Do not rely on inherited thread context alone to load repo personas or pipeline-specific instructions.
- Apply the delegated bootstrap and reserved-name validity guard from `<AI_DEV_SHOP_ROOT>/skills/coordination/SKILL.md`. A parallel helper without first-reply persona confirmation is invalid; a parallel helper that claims a reserved pipeline agent name without that confirmation is a mandatory blocker.
- If independence is unclear, investigate first instead of parallelizing blindly.
- If conflicts appear on return, resolve them before claiming the parallel split was valid.

## Output

- domain split rationale
- per-domain task prompts
- conflict check result
- combined verification result

## Reference

- Preconditions:
  - at least two meaningful work items exist
  - the work can be isolated without shared-state conflicts
- Decision rule:
  - parallelize only when fixing one domain is unlikely to fix or change the others
  - keep work sequential when ownership, state, or edited files overlap
- Examples: [references/examples.md](references/examples.md)
- Original source: [ORIGINAL.md](ORIGINAL.md)
