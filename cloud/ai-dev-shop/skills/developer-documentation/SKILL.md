---
name: developer-documentation
version: 1.0.0
last_updated: 2026-03-13
description: Use when writing or reviewing README files, tutorials, API references, migration guides, changelogs, and release notes for developers or integrators.
---

# Skill: Developer Documentation

Use this for README files, tutorials, API references, migration guides, changelogs, and release notes. This is for developer-facing docs, not product specs or ADRs.

## Trigger

- Writing or revising a `README.md`
- Creating setup or quickstart guides
- Publishing API or SDK documentation
- Writing migration guides for breaking changes
- Creating changelog entries or release notes
- Reviewing docs for accuracy against the code or spec

## Rules

- Lead with the user task, not project backstory.
- Every example must match the current interface and be plausible to run.
- Separate quickstart, concept, reference, and migration content instead of mixing them.
- State prerequisites explicitly.
- If behavior changed, document both the change and what existing users must do next.

## Workflow

1. Identify the reader, starting state, and desired outcome.
2. Write the 30-second entry point: what this is, why it matters, how to start.
3. Build a shortest-path quickstart that produces a visible result.
4. Add deeper reference material only after the quickstart path is clear.
5. Document breaking or high-impact changes with migration steps and compatibility notes.
6. Verify examples, command names, file paths, and config keys against the current implementation or approved spec.

## Inline Comment Discipline

Comment the **why**, not the what. Well-named identifiers explain what code does. Comments exist for hidden constraints, subtle invariants, workarounds for specific bugs, or behavior that would surprise a future reader. If removing the comment wouldn't confuse anyone, don't write it.

The `@important` pattern: use `// @important: <reason>` for traps that future engineers will fall into — non-obvious behavior, known gotchas, or constraints that look removable but aren't.

*Source: Addy Osmani / agent-skills / documentation-and-adrs*

## References

- README structure: `references/readme-template.md`
- API docs and migration guides: `references/api-and-migration-docs.md`
- Tutorial structure and teaching flow: `references/tutorial-pattern.md`
- Changelog format and known-gotchas pattern: `references/changelog-template.md`
