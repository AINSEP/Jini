# External Audit Proposed Fixes

**Date:** <ISO-8601>
**Scope:** <work-log | current-diff | staged | last-commit | custom>
**Focus:** <the user's audit question>
**Suggested Changes Mode:** <patches | notes>
**Source Audit Report:** <path to external audit report>
**Auditors With Suggestions:** <claude, gemini, codex, or subset>

## Summary
- <what the auditors proposed changing and why>

## Coordinator Handling Guidance
- These are proposal artifacts only.
- The main LLM or human reviewer may accept, adapt, or reject them.
- Do not apply these files automatically.

## File Suggestions

| Path | Suggestion Type | Artifact | Notes |
|---|---|---|---|
| `<path>` | `<notes | diff | snippet>` | `<proposed-fixes.md or patches/<auditor>-...>` | <auditor and short rationale> |

## Notes And Snippets
- <raw note-style suggestion or bounded replacement snippet>

## Patch Files
- `patches/<auditor>-0001-<slug>.diff`
- `patches/<auditor>-0002-<slug>.diff`

## Raw Auditor Extract
- <optional preserved block copied from the auditor output when splitting would lose context>
