---
name: implementation-guardrails
version: 1.4.1
last_updated: 2026-10-07
description: Use when implementing or reviewing backend/general code so complexity, scaling, and maintainability guardrails stay consistent: scaling sanity checks, selective complexity comments, query-shape awareness, the reuse-before-write decision, one-source-of-truth rules, and readable call-site defaults.
---

# Skill: Implementation Guardrails

Apply this skill when writing or reviewing general application code paths that need explicit complexity, performance, and maintainability guardrails.

This skill is a child layer on top of `coding-foundations`. It is for author-time and review-time implementation discipline, not for defining the shared baseline axioms.

Do not wire this skill by itself. Any agent that loads `implementation-guardrails` must also load `coding-foundations` explicitly.

## Ownership

- Programmer owns first-pass complexity and scaling decisions while writing code.
- Code Inspection is the backstop for missed issues and unjustified deviations.
- Refactor owns non-blocking complexity debt after the behavior is already correct.
- TestRunner owns empirical performance evidence only when the active tasks or spec define performance constraints.

## Load Strategy

Start here, then load only the reference you need:

- `references/complexity-comments.md` when code handles caller-controlled or unbounded input, nested iteration, query fan-out, batch work, or a custom algorithm
- `references/defaults-checklist.md` when you want the concrete implementation defaults and review signals in one place

## Core Rules

1. Do an author-time scaling sanity check for any changed path that iterates caller-controlled input, nests loops, batches work, or risks per-item I/O.
2. Add a short inline complexity note only when the cost, query shape, or tradeoff is non-obvious and materially relevant to future maintainers.
3. For data-heavy code, make query or network fan-out explicit. Prefer bounded bulk reads/writes over hidden per-item I/O.
3b. For any function that calls an external service for a user-variable collection (roles, items, permissions, records), enforce resource bounds: maximum collection size (configurable cap), timeout on service calls, and defined behavior at the cap (error, truncate, or paginate). Do not assume typical usage equals worst-case usage.
4. Keep one source of truth for business rules, mapping tables, config lookups, and shared lifecycles or security-sensitive sequences (for example permission check → secret exchange → sealed store → outcome report); do not duplicate them across modules. See Before You Write.
5. Avoid boolean flag parameters when an enum, options object, or named variant would make the call site clearer.
6. Prefer descriptive names and flow over clever compactness on non-trivial paths.
7. If performance or framework constraints force a non-obvious tradeoff, leave the reason near the code.

## Before You Write

This section is the single home of the reuse-before-write decision. Other skills and personas point here; they do not restate it.

It applies to new or materially changed behavior, including functions and helpers inside existing files, not only new modules.

1. **Understand first.** Read the task and trace the real flow it touches end to end before choosing an implementation. This decision shortens the solution, never the reading.
2. **Search wide, not near.** Search the project, and the workspace or platform libraries named by its manifests, conventions, or the brief, for the behavior and its invariants, not only the files next to your task. Inspect plausible owners and their contracts, not every file; related variants share one discovery pass. Record unavailable sources or unresolved ownership and route that decision through Coordinator.
3. **Stop at the first option that satisfies the required behavior, security boundaries, and approved architecture:**
   1. Does this behavior need to exist at all? Skip only behavior that no current requirement or recorded constraint supports, and name the omission in one line. Conventions required by recorded rules are not speculative, for example the Programmer's `(input, options = {})` boundary signature, which is kept even when no option exists yet.
   2. An existing implementation that owns this behavior: call or extend it.
   3. The language standard library.
   4. A native platform capability: HTML element, CSS, browser API, framework built-in, or database constraint.
   5. An already-installed dependency. Do not add a new dependency for what a few readable lines can do.
   6. Only then: the smallest readable new code.
4. **Reuse means calling or extending the implementation that owns the behavior.** Copying a sibling's lifecycle is not reuse, and a style precedent does not establish a new behavior owner. A sibling may illustrate style; it never stands in for the ownership decision.
5. **Variants without a shared owner.** When existing variants share invariants but have no common implementation, identify the shared behavior and the real differences before adding another variant, then propose the smallest shared mechanism or state why separate ownership is justified. Consolidation follows shared invariants, not instance counts. Boundary changes route through Coordinator. Consolidating persisted variants (tables, stored formats) is a migration decision, not an automatic cleanup. If shared ownership is selected, the shared mechanism is dispatched and lands before dependent variant tasks. If separate ownership is justified, record the differing contracts or invariants and dispatch the variants accordingly.
6. **A named owner is binding.** Once a brief, ADR, governance ADR, or Critical Internal Constraints record names a behavior's owner, a new parallel owner of that behavior is an architecture violation and Required; cite the record. If records conflict, the named owner is unsuitable, or its contract is missing, route the decision through Coordinator before implementation. Ownership changes only through the existing ADR revision or CIC deviation procedures, naming the superseded decision; a handoff claim alone does not change ownership. Otherwise unjustified duplication is Recommended. Neither instance count nor removable lines decides disposition.
7. **Rule-of-three heuristics elsewhere apply to incidental code only.** Shared lifecycles, security-sensitive sequences, and behaviors with a named owner follow this section, not an instance count.

## Complexity Note Rule

- A note like `// O(n)` by itself is not enough.
- If you add a complexity note, define what the variable means and why the cost is acceptable.
- If query or network fan-out is the real concern, note the query shape in the same comment.
- Do not annotate trivial scans, getters, or obvious standard-library usage just to satisfy the rule.

## What Stays Out

- baseline dependency, purity, mutation, contract, and fail-fast rules that live in `coding-foundations`
- parameter conventions, test seam rules, typed error contracts, and UI test exemptions
- architecture- or framework-specific pattern rules that belong in other skills

## Review Signals

When this skill is active during review, look for:

- per-item database, network, or filesystem calls inside loops
- non-obvious expensive paths with no explanation
- query or network fan-out hidden inside collection transforms
- performance-driven mutation or batching with no rationale
- boolean flag parameters where an enum or options object would be clearer
- duplicated rules or lookup tables that should have one source of truth
- new or materially changed behavior that parallels an existing owner (Before You Write; the review procedure is Code Inspection's Dimension 4)
- clever compactness that obscures cost or intent

## Output Expectations

When this skill materially shaped the implementation or review, report:

- changed paths that required complexity or query-shape notes
- important maintainability tradeoffs or performance justifications
- justified deviations from the default guardrails
- one Reuse line per distinct new or materially changed behavior: `Reuse: <behavior>; searched <areas and search terms>; inspected <candidate paths or symbols, or none found>; used <option and implementation> | separate because <specific contract or invariant difference>; owner record <reference, or none>`. "searched repo; none fit" is not evidence.

## References

- `references/complexity-comments.md`
- `references/defaults-checklist.md`
