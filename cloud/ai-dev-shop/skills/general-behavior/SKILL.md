---
name: general-behavior
version: 0.3.0
last_updated: 2026-06-29
description: Thin universal dispatcher for cross-cutting agent behavior. Load the matching reference before acting for code navigation, possible improvements/alternatives, or low-reasoning mechanical subagent delegation.
---

# Skill: General Behavior

Thin universal dispatcher for behaviors that apply to **every** agent. Load the matching `references/` file just-in-time.

| When you need to... | Load this reference |
|---|---|
| find or understand code (callers, callees, references, usage, impact, architecture, "where is X") | `references/code-navigation.md` |
| answer a request for thoughts or a proposed approach, and a materially better path or useful alternative is visible | `references/possible-improvements-and-alternatives.md` |
| delegate low-reasoning mechanical work such as browser automation, image processing, repetitive extraction, or raw data collection | `references/mechanical-subagent-delegation.md` |

## Maintainer note (do not remove)

Keep this file minimal because it is injected into **every** agent. Add lightweight universal behavior in `references/`; use independent `skills/` only for substantial workflows. **Never** inline routing tables, commands, or examples here.
