---
name: superpowers-finishing-a-development-branch
description: Use when implementation is done and you need to wrap up the branch cleanly. Verifies readiness, then offers merge, PR, keep, or discard paths.
---

# Superpowers Finishing A Development Branch

Close out implementation with a small, explicit decision tree.

## Execution

- Run the full verification command first.
- Identify the base branch.
- Present exactly four choices: merge locally, push and open a PR, keep the branch as-is, or discard the branch.
- Execute only the chosen path.
- Clean up the worktree when appropriate.

## Guardrails

- Do not offer completion choices until verification passes.
- Do not delete work without explicit confirmation.
- Do not force-push unless the user asked for it.
- Keep the options concise and consistent.
- If tests fail, stop and report instead of offering closeout options.

## Output

- chosen completion path
- commands run
- final branch state
- final worktree state

## Branch and Commit Standards

**Trunk-Based Development** is the recommended default (DORA research: high-performing engineering teams use short-lived branches merged frequently to trunk). Keep branches alive for hours or days, not weeks. Long-lived branches are a merge-debt accumulation pattern.

Load `references/commit-standards.md` for:
- Conventional commit types table (feat/fix/refactor/test/docs/chore)
- Change Summaries pattern — the structured post-implementation communication format with CHANGES MADE / THINGS I DIDN'T TOUCH / POTENTIAL CONCERNS sections

*Source: Addy Osmani / agent-skills / git-workflow-and-versioning*

## Reference

- Preconditions:
  - implementation work is complete
  - a full verification command exists
- Decision rule:
  - preserve the worktree for PR or keep-as-is paths unless the user asks otherwise
  - remove the worktree after merge or discard if it was created for this branch
- Required prompt:
  ```text
  Implementation complete. What would you like to do?

  1. Merge back to <base-branch> locally
  2. Push and create a Pull Request
  3. Keep the branch as-is (I'll handle it later)
  4. Discard this work
  ```
- Examples: [references/examples.md](references/examples.md)
- Pair with [superpowers-using-git-worktrees](../superpowers-using-git-worktrees/SKILL.md)
- Original source: [ORIGINAL.md](ORIGINAL.md)
