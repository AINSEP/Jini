---
name: gstack-ios
version: 0.1.0
last_updated: 2026-06-05
description: Use when a user manually invokes gstack-inspired iOS workflows for QA, bug fixing, HIG design review, debug cleanup, or debug bridge sync.
---

# Skill: gstack iOS

Manual/slash-invoked domain skill adapted from gstack iOS workflows. This skill is not wired into the default pipeline.

## Execution

- Determine the requested iOS mode from the prompt or slash command arguments.
- Select exactly one mode per invocation: `qa`, `fix`, `design-review`, `clean`, or `sync`.
- Read exactly one matching reference file from `references/` before taking action.
- Do not load all references, chain modes, or silently expand into pipeline agent dispatch.
- Inventory the iOS project, target device/simulator availability, and build context before making changes.
- If the user request spans multiple modes, ask which mode to run first.

## Guardrails

- Do not assume gstack iOS daemons, remote tunnels, debug bridge binaries, or generated file paths exist.
- Use simulator/device paths only when the current environment can prove they are available.
- CRITICAL: You MUST STOP and request explicit user confirmation before executing any commands that delete directories, remove debug wiring, clean caches, rewrite generated templates, or alter signing/deploy settings. Do not proceed until the user says "yes" or "approved".
- Keep bug fixes narrow; do not refactor unrelated Swift, SwiftUI, Xcode, or package configuration.
- Do not claim live-device evidence unless it was captured in the current run.

## Output

Return a concise iOS artifact for the selected mode:

- selected mode and reference used
- project/device context inspected
- actions taken or proposed
- evidence captured
- approval gates and follow-up

## Reference

Read exactly one reference based on intent:

- `references/qa.md` - device/simulator QA, scenario testing, and evidence report.
- `references/fix.md` - reproduce, diagnose, patch, and verify a bounded iOS bug.
- `references/design-review.md` - iOS visual, HIG, accessibility, and platform-idiom audit.
- `references/clean.md` - safe release cleanup of debug bridge or debug-only wiring.
- `references/sync.md` - explicit debug bridge/template regeneration or sync workflow.
- `references/upstream-notes.md` - provenance only; do not load for normal execution unless reviewing upstream drift.

## Failure Path

- If no iOS project is present, stop and report that the skill cannot run.
- If no device or simulator is available, produce a fallback inspection plan rather than pretending live QA happened.
- If cleanup or sync scope is unclear, inventory first and ask for explicit approval.
