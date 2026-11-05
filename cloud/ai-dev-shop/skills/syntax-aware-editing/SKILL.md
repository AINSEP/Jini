---
name: syntax-aware-editing
version: 1.0.1
last_updated: 2026-03-24
description: Use when a change is primarily a structured code edit such as symbol renames, import/export rewrites, signature propagation, JSX or TSX prop updates, or module moves where parser-backed edits are safer than raw text replacement.
---

# Skill: Syntax-Aware Editing

Syntax-aware editing means changing code as parsed structure rather than as raw text. The point is not sophistication for its own sake. The point is fewer malformed edits, fewer missed call sites, and fewer accidental changes to unrelated text that merely looks similar.

> Status: Canonical but inactive by default. No default agent currently loads this skill from the shared registry. It becomes active only when an agent explicitly opts into it, and full automation requires a supported parser-backed or type-aware tool for the active language.

## Load Strategy

Start here, then load only the language reference that matches the files you are touching:

- `references/typescript-javascript-tsx.md` for `.ts`, `.tsx`, `.js`, `.jsx`, React components, Node/browser module graphs, and TypeScript-aware symbol propagation

Add future language adapters as sibling reference files. Do not load multiple language references unless the edit genuinely crosses language boundaries.

## Prerequisites

This skill has two operating modes:

- **Full mode**: a parser-backed or type-aware edit tool is installed for the active language
- **Fallback mode**: no supported structured-edit tool is installed, so the agent must fall back to narrow manual edits

Repo users do not need to install every tool listed in a language reference. They do need at least one supported tool for that language if they want real syntax-aware automation instead of policy-only guidance.

If no supported tool is installed:

- the skill is still valid to load
- the agent should say that structured editing is unavailable
- the agent should fall back to careful text edits and manual review

Language references should state:

- which tools satisfy the prerequisite
- which tool is the recommended first install
- what the fallback behavior is when no tool exists

## Use This Skill When

- Renaming exported symbols or widely used locals
- Adding, removing, or rewriting imports and exports
- Changing a function or component signature and propagating call-site updates
- Renaming, adding, or removing JSX or TSX props
- Moving declarations between modules while repairing the module graph
- Updating interfaces, types, or contracts whose consumers need coordinated edits

## Do Not Use This Skill For

- Docs, prose, comments-only work, or Markdown edits
- Small local literal changes inside one function where structure is irrelevant
- SQL, YAML, JSON, or config edits unless a language reference explicitly covers them
- Blind whole-repo string replacement across unknown files

## Language Selection

1. Detect the language from the touched files first.
2. Use repo signals only as secondary hints: `package.json`, `tsconfig.json`, `jsconfig.json`, `pyproject.toml`, `pom.xml`, and similar files.
3. If no matching language reference exists, fall back to narrow text edits and state that structured editing is unavailable for this language.
4. If the change crosses supported and unsupported languages, split the work: use syntax-aware editing where supported and manual edits elsewhere.

## Core Workflow

1. Classify the edit. If it is structure-preserving or requires coordinated updates across related code sites, prefer syntax-aware editing.
2. Load one language reference and follow its preferred tool order.
3. Anchor the change to the owning symbol, node, or file. Do not edit by ambiguous string match when a parser-backed target exists.
4. Update dependent sites in the same edit set: imports, exports, type references, call sites, JSX props, tests, and intentional symbol mentions in inline docs when relevant.
5. Run the minimum structural checks from the language reference before claiming completion.
6. If the available tools cannot make the change safely, reduce scope or escalate instead of doing a blind global replace.

## Safety Rules

- Prefer type-aware rename and move tools over plain AST transforms when available.
- Prefer AST or parser-backed transforms over regex or raw text replacement for coordinated edits.
- Keep generated files, snapshots, lockfiles, and vendored code out of scope unless explicitly required.
- Treat dynamic dispatch, string-based reflection, computed property access, and framework magic as manual-review risk zones.
- Do not assume comments, docstrings, or string literals should follow a code rename automatically. Update them intentionally.

## Expected Output

- What structured edit was performed
- Which language reference was used
- Which dependent sites were updated
- Which structural checks were run
- Remaining manual follow-up or unsupported edges
