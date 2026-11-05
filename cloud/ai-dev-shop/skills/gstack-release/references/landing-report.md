# Landing Report

## When

Use for a read-only view of what is ready, queued, recently landed, or blocked in a release flow.

## Workflow

1. Inspect available read-only sources: git branch/log, tags, PR metadata, CI status, deploy metadata, or local release notes.
2. Identify pending work, landed work, blockers, and missing evidence.
3. Keep the report factual; do not change branches, close PRs, update versions, or trigger deploys.
4. Suggest the next safest release action.

## Output

- Current branch and base
- Pending/landed/blocked table
- Missing evidence
- Suggested next action

## Guardrails

- Read-only mode only.
- Do not modify files, push, merge, deploy, or close PRs.
- If source systems are unavailable, label the report partial instead of filling gaps with guesses.
