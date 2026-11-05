# Git Worktree Examples

Load this only when you want concrete command patterns or edge-case examples.

## Example Setup Flow

```bash
git check-ignore -q .worktrees
git worktree add .worktrees/feature-auth -b feature/auth
cd .worktrees/feature-auth
npm install
npm test
```

## Example Status Report

```text
Worktree ready at /path/to/repo/.worktrees/feature-auth
Branch: feature/auth
Setup run: npm install
Baseline verification: npm test (pass)
```

## Location Decision Rule

- Use `.worktrees/` if present.
- Otherwise use `worktrees/` if present.
- Otherwise check project guidance.
- Otherwise ask the user.

## Failure Case

If the baseline test run fails, stop and report the failure before starting feature work. The worktree exists, but the branch is not a clean baseline.
