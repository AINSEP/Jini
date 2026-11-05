<!-- Source: Addy Osmani / agent-skills / git-workflow-and-versioning -->

# Commit Standards

## Part 1: Conventional Commit Types

| Type | Description | Example |
|---|---|---|
| `feat` | Adds user-visible functionality | `feat: add saved search filters` |
| `fix` | Fixes incorrect behavior | `fix: handle empty export results` |
| `refactor` | Changes implementation without changing behavior | `refactor: extract invoice total calculation` |
| `test` | Adds or updates tests | `test: cover expired session redirect` |
| `docs` | Updates documentation only | `docs: document webhook retry behavior` |
| `chore` | Maintenance work that is not feature, fix, refactor, test, or docs | `chore: update lint configuration` |

## Part 2: Change Summaries

Use this structure after implementation so reviewers understand scope, intent, and risk.

```markdown
## CHANGES MADE

- What changed.
- Why it changed.
- How the implementation works at a high level.

## THINGS I DIDN'T TOUCH

- What was intentionally left unchanged.
- Why it was out of scope.
- Any related issues that should remain separate.

## POTENTIAL CONCERNS

- Risks, tradeoffs, edge cases, or follow-up work.
- Tests that were not run.
- Areas that need reviewer attention.
```

## Why "Didn't Touch" Matters Most

`THINGS I DIDN'T TOUCH` demonstrates scope discipline. It tells reviewers that omissions were intentional, not accidental, and that the implementation did not silently expand into adjacent systems. This is often the most important section because it reduces review ambiguity and prevents unrelated work from hiding inside a change.
