---
name: gstack-design
version: 0.1.0
last_updated: 2026-06-05
description: Use when a user manually invokes gstack-inspired design workflows for product design consultation, visual variants, frontend implementation handoff, or UI design review.
---

# Skill: gstack Design

Manual/slash-invoked domain skill adapted from gstack design workflows. This skill is not wired into the default pipeline.

## Execution

- Determine the user's requested design mode from the prompt or slash command arguments.
- Select exactly one mode per invocation: `consultation`, `shotgun`, `html`, or `review`.
- Read exactly one matching reference file from `references/` before taking action.
- Do not load all references, chain modes, or silently expand into pipeline agent dispatch.
- Preserve existing AI Dev Shop design rules, accessibility expectations, and project constraints.
- If the user request spans multiple modes, ask which mode to run first.

## Guardrails

- Do not assume upstream-specific runtime services, generated boards, analytics hooks, or external binaries exist.
- Do not implement code during `consultation`, `shotgun`, or `review` unless the user explicitly changes scope.
- In `html` mode, treat "html" as a legacy shorthand for frontend implementation/prototype handoff; do not force raw HTML when the project has a framework.
- Do not replace existing brand or design systems without explicit user approval.
- Do not claim browser or screenshot evidence unless it was actually captured in the current host.

## Output

Return a concise design artifact for the selected mode:

- selected mode and reference used
- inputs inspected
- recommendation or findings
- open questions or approval gates
- next action, if any

## Reference

Read exactly one reference based on intent:

- `references/consultation.md` - new product direction, design system, brand/aesthetic proposal, or design strategy.
- `references/shotgun.md` - multiple visual directions, option exploration, comparison, or taste feedback.
- `references/html.md` - approved design to frontend implementation guidance or static prototype.
- `references/review.md` - audit existing UI for hierarchy, spacing, accessibility, consistency, or AI slop.
- `references/upstream-notes.md` - provenance only; do not load for normal execution unless reviewing upstream drift.

## Failure Path

- If no mode is clear, ask for one choice.
- If required product context is missing, produce a bounded assumption list rather than inventing facts.
- If a requested action conflicts with AI Dev Shop frontend/design guardrails, state the conflict and ask for approval before proceeding.
