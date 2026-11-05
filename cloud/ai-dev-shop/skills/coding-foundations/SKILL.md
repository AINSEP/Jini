---
name: coding-foundations
version: 1.0.0
last_updated: 2026-04-11
description: Use when writing or reviewing application code so the repo's shared micro-level foundations stay consistent: explicit dependencies, pure-by-default decision logic, mutation-by-exception, stable contracts, fail-fast validation, and small readable units.
---

# Skill: Coding Foundations

Apply this skill whenever a role needs the shared micro-level coding axioms that multiple child skills depend on.

This is the tiny parent skill for downstream coding standards. Keep it small and stable. Put only rules here that both `implementation-guardrails` and `testable-design-patterns` genuinely rely on.

There is no automatic skill-dependency loader assumed in this repo. Any agent that loads a child skill built on these foundations must list `coding-foundations` explicitly in its agent wiring.

## Ownership

- Software Architect sets these as downstream constraints when micro-level implementation guidance matters.
- Programmer applies them while writing code.
- Code Inspection is the backstop for violations or unjustified deviations.

## Load Strategy

Start here, then load only the reference you need:

- `references/foundations-checklist.md` for the compact default checklist and review signals
- `references/purity-and-boundaries.md` when deciding where logic should stay pure and where side effects belong

## Core Rules

1. Keep dependencies explicit. Do not hide clocks, random sources, repositories, config, or clients behind globals or inline construction in logic-bearing code. Avoid module-level singletons and append-only registries; inject registry instances with unregister and reset lifecycles (see `references/purity-and-boundaries.md`).
2. Separate decision logic from effect execution where practical. Pure or mostly-pure decision steps should be obvious; effectful wrappers should be thin and explicit.
3. Prefer not mutating inputs or shared state by default. If mutation is required, the contract or performance reason must be obvious near the code.
4. Keep exported contracts explicit and stable. Favor named fields and predictable shapes at module boundaries.
5. Fail fast on invalid input or impossible state unless the spec explicitly requires graceful degradation or recovery. Expose failures as a typed outcome or typed error; never silently swallow them. If a check guarding an irreversible action errors or cannot decide, deny the action (irreversible class: `<AI_DEV_SHOP_ROOT>/skills/critical-internal-constraints/SKILL.md`, Bindingness).
6. Keep units small and readable enough that the next agent can reason about them without reading surrounding subsystems or git history.

## What Stays Out

- complexity thresholds, query-shape notes, and scaling commentary
- coverage-specific branch rules, seam rules, and UI test exemptions
- framework-specific composition rules
- domain- or architecture-specific patterns that belong in other skills

## Output Expectations

When these foundations materially shaped a design or review, report:

- the important dependency or boundary decisions
- any justified mutation or impurity
- any contract or fail-fast choice that could surprise a future maintainer

## References

- `references/foundations-checklist.md`
- `references/purity-and-boundaries.md`
