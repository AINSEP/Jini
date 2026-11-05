---
name: gstack-release
version: 0.1.0
last_updated: 2026-06-05
description: Use when a user manually invokes gstack-inspired release workflows for shipping a branch, landing and deploying, canary monitoring, release reporting, or deploy setup.
---

# Skill: gstack Release

Manual/slash-invoked domain skill adapted from gstack release workflows. This skill is not wired into the default pipeline.

## Execution

- Determine the requested release mode from the prompt or slash command arguments.
- Select exactly one mode per invocation: `ship`, `land-and-deploy`, `canary`, `landing-report`, or `setup-deploy`.
- Read exactly one matching reference file from `references/` before taking action.
- Do not load all references, chain modes, or silently expand into pipeline agent dispatch.
- Prefer read-only inspection until the user explicitly asks for a write, push, merge, or deploy action.
- If the user request spans multiple modes, ask which mode to run first.

## Guardrails

- Do not assume gstack version queues, release scripts, workspace-aware ship internals, or deployment binaries exist.
- CRITICAL: You MUST STOP and request explicit user confirmation before executing any commands that push commits, create pull requests, merge branches, delete branches, change versions, edit changelogs, clean caches, or trigger external deployments. Do not proceed until the user says "yes" or "approved".
- Do not bypass AI Dev Shop review, test, security, or human approval gates.
- Do not perform production deploys, rollback, or canary changes automatically; report and recommend unless specifically approved.
- Do not include secrets or credential values in release notes, deploy configs, or reports.

## Output

Return a concise release artifact for the selected mode:

- selected mode and reference used
- repo/deploy context inspected
- readiness status
- approval gates
- actions taken or proposed
- verification evidence

## Reference

Read exactly one reference based on intent:

- `references/ship.md` - branch finishing, checks, changelog/version/PR readiness.
- `references/land-and-deploy.md` - merge, deploy, and production verification flow.
- `references/canary.md` - post-deploy health and browser/HTTP monitoring loop.
- `references/landing-report.md` - read-only release queue or landing status dashboard.
- `references/setup-deploy.md` - detect and document deployment platform, commands, URLs, and rollback.
- `references/upstream-notes.md` - provenance only; do not load for normal execution unless reviewing upstream drift.

## Failure Path

- If the deploy platform or base branch cannot be determined safely, stop with a readiness report.
- If checks fail, report blockers instead of pushing, merging, or deploying around them.
- If production access is unavailable, produce a manual verification checklist.
