---
name: superpowers-using-git-worktrees
description: Use when work needs an isolated branch workspace or before implementation in a dirty repo. Sets up a safe git worktree and verifies the baseline.
---

# Superpowers Using Git Worktrees

Create an isolated workspace before implementation when the current tree should stay untouched.

## Execution

- Prefer an existing `.worktrees/` or `worktrees/` directory if present.
- If neither exists, check project guidance files for a preferred location; otherwise ask the user.
- For project-local worktrees, verify the directory is ignored before creating it.
- Create the new worktree on a dedicated branch.
- Run project setup and a baseline verification command.
- Report the worktree path and whether the baseline is clean.

## Guardrails

- Do not create a project-local worktree unless the directory is ignored.
- Do not treat the worktree as ready until setup and baseline verification have run.
- If the baseline already fails, surface that before starting feature work.
- If baseline verification fails, stop and report instead of proceeding.

## Output

- worktree path
- branch name
- setup commands run
- verification result

## Reference

- Preconditions:
  - current repo is a git repository
  - a branch name is known or can be chosen
- Decision rule:
  - auto-pick an existing worktree directory if present
  - ask only when no project convention or existing directory exists
- Core commands:
  ```bash
  git worktree add "$path" -b "$branch"
  git check-ignore -q .worktrees
  git check-ignore -q worktrees
  ```
- Pair with [superpowers-finishing-a-development-branch](../superpowers-finishing-a-development-branch/SKILL.md)
- Examples: [references/examples.md](references/examples.md)
- Original source: [ORIGINAL.md](ORIGINAL.md)
