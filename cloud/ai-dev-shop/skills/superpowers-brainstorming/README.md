# Superpowers Brainstorming Layout

This skill now follows the normalized imported-skill layout:

- `SKILL.md`
- `ORIGINAL.md`
- `references/spec-document-reviewer-prompt.md`
- `references/visual-companion.md`

## Why

The first import pass kept active companion files at the skill root to mirror `obra/superpowers` more closely.
The framework has since standardized on a cleaner rule: only `SKILL.md` and `ORIGINAL.md` stay at the root, and all companion material lives under `references/`.

## Folder Roles

- `SKILL.md`
  - active execution-optimized runtime skill
- `ORIGINAL.md`
  - preserved original main skill from `obra/superpowers`
- `references/`
  - active adapted support files used by this toolkit
  - extracted examples and deeper usage patterns
- `references/original/`
  - preserved original companion source files from `obra/superpowers`
