# Ship

## When

Use to finish a branch and prepare it for review or pull request without automatically pushing or merging.

## Workflow

1. Inspect branch, base branch, uncommitted changes, and recent commits.
2. Identify required checks: tests, lint, typecheck, security, docs, and changelog/version policy.
3. Run or request the narrowest safe checks available.
4. Draft changelog, version, commit, and PR body changes when requested.
5. Summarize readiness: ready, blocked, or needs approval.
6. Ask for explicit approval before any write, commit, push, or PR creation.

## Output

- Branch/base status
- Check results or required manual checks
- Release notes/changelog draft if requested
- PR readiness summary
- Approval gates

## Guardrails

- CRITICAL: You MUST STOP and request explicit user confirmation before executing any commands that push commits, create pull requests, change versions, edit changelogs, or clean caches. Do not proceed until the user says "yes" or "approved".
- Do not create a PR if tests or required review gates are unresolved.
- Do not squash, rebase, or rewrite history unless explicitly requested.
