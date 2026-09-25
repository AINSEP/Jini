---
name: interface-design
version: 1.0.0
last_updated: 2026-03-18
description: Use when designing interfaces for dashboards, apps, tools, or admin panels where craft, memory, and consistency matter. Not for marketing sites.
---

# Skill: Interface Design

Interface design here means deliberate visual systems, not generic UI output. Use this skill when the user wants a project-specific look and repeatable design decisions across sessions.

## Scope

- Use for product interfaces, internal tools, dashboards, admin panels, and workflow apps.
- Do not use for marketing sites or copy-first landing pages.
- Prefer this skill when the user wants a visual system rather than isolated component styling.

## Load Strategy

Read this file for the runtime contract. Open references only when you need the heavier material:

- `references/system-template.md` for the `.interface-design/system.md` shape and token scaffold
- `references/commands/init.md` for the build-first workflow
- `references/commands/audit.md` for checking existing code against a system
- `references/commands/extract.md` for deriving a system from existing code
- `references/commands/status.md` for reporting the active design system
- `references/commands/critique.md` for craft-focused review and rebuild guidance
- `references/examples/system-precision.md` and `references/examples/system-warmth.md` for two concrete directions

## Core Contract

- Establish or load `.interface-design/system.md` before making repeated UI decisions.
- Reuse spacing, radius, depth, and typography choices consistently.
- State the design direction explicitly before building a component or screen.
- Capture new stable patterns in `.interface-design/system.md` instead of letting them drift across files.

## Practical Defaults

- Keep the system tangible: direction, foundation, depth, tokens, patterns.
- Prefer a small number of explicit design choices over a long list of vague principles.
- When an existing interface already has a recognizable pattern set, preserve it and extend it rather than replacing it wholesale.
