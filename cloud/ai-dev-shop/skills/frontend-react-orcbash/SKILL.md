---
name: frontend-react-orcbash
version: 1.3.1
last_updated: 2026-03-17
description: Use only for React frontend code structured with the Orc-BASH pattern (Orchestration, Business Logic, API, State Management, Hooks) — a React-specific specialization of hexagonal architecture with explicit UI-facing test seams.
---

# Skill: Frontend React — Orc-BASH Pattern

Orc-BASH is a React-specific specialization of hexagonal architecture.

Use this skill only for React and Next.js frontend implementation.

- For Python, backend TypeScript, Go, Java, CLIs, workers, or general service code, use `<AI_DEV_SHOP_ROOT>/skills/hexagonal-architecture/SKILL.md` instead.
- Do not apply Orc-BASH outside React UI architecture.
- Keep this file lean. Load references only when you need concrete examples or drop-in code structure.

## Core Model

The Orchestrator is the only layer that knows about all other layers. Business Logic, API, and State Manager have zero dependencies on each other. UI depends only on the Orchestrator.

```text
Business Logic ──┐
API ─────────────┼──→ Orchestrator ──→ UI
State Manager ───┤
Hooks ───────────┘
```

Dependency flow rules:

1. Business Logic, API, and State Manager import from shared `types/` only.
2. Hooks receive external dependencies through an explicit typed `deps` contract from the orchestrator.
3. Orchestrators compose the dependencies they receive and construct no infrastructure; root ownership follows `<AI_DEV_SHOP_ROOT>/skills/hexagonal-architecture/SKILL.md` (Required Design Rules). No hidden globals, no direct store imports from hooks, no implicit singletons looked up inside hooks.
4. UI components consume orchestrator outputs only.
5. If dependency injection is bypassed in any layer, stop and refactor before handoff.

Dependencies should be passed in this priority order:

1. Data
2. Functions
3. Classes

## Load Strategy

Read this file for the contract. Open references only when needed:

- `references/feature-slice-drop-in-template.md` for folder shape and slice bootstrapping
- `references/typedoc-return-types-example.md` for typed signatures, feedback contracts, and return-type examples
- `references/post-feature-example.md` for a full six-layer implementation example with a generic state-adapter boundary
- `references/state-manager-zustand.md` for a concrete Zustand-backed state implementation

## Shared Micro-Level Rules

Use `<AI_DEV_SHOP_ROOT>/skills/coding-foundations/SKILL.md` for the shared micro-level baseline:

- explicit dependencies at hook, orchestrator, and adapter boundaries
- decision/effect separation where practical
- mutation-by-exception
- stable contracts and fail-fast defaults

Use `<AI_DEV_SHOP_ROOT>/skills/testable-design-patterns/SKILL.md` for stricter testability rules:

- required two-object parameter convention
- explicit return types and TypeDoc/TSDoc expectations
- testability-first boundaries for functions, hooks, and orchestrators
- `useEffect` coordination guidance and side-effect isolation

## Type and Documentation Requirements

- Every exported function, hook, and orchestrator must declare an explicit return type.
- Every exported function and hook must include TypeDoc/TSDoc with `@param` and `@returns`.
- Internal/private hooks and helpers must also be documented when they coordinate side-effects or domain behavior.
- Do not rely on inferred return types at Orc-BASH layer boundaries.

## Canonical Slice Shape

```text
/features/<domain>/
├── types/
├── api/
├── logic/
├── state/
├── hooks/
├── orchestrators/
└── views/
```

Notes:

- `types/` is the only allowed cross-layer import location.
- `state/` should usually contain a port interface, an adapter, and the concrete store.
- Different pages can have different orchestrators while reusing the same hook.
- Cross-domain coordination happens through orchestrators, not by importing one domain's internals into another.

## Layer Contracts

| Layer | Owns | Must Not Do |
|---|---|---|
| API | Network requests and transport details | Hold UI state, import stores, choose UI messaging |
| Business Logic | Validation, transformations, domain rules | Import state, call API directly from UI, depend on React |
| State | Concrete store implementation plus port/adapter seam | Know about API or business logic |
| Hooks | UI-local state, lifecycle-aware logic, async coordination | Import API/state/logic implementations directly |
| Orchestrator | Explicit wiring of API, logic, state, and hook outputs | Become a god object or hide dependencies |
| UI | Rendering and event wiring | Contain non-trivial business logic or reach below orchestrator |

Hook structure rules:

- Use three sub-hooks when the feature needs them: UI State Hook, optional Business Logic Hook, and Integration Hook.
- UI State Hook is for ephemeral view state only.
- Business Logic Hook is only for lifecycle-aware wrapping of domain logic.
- Integration Hook is the exported hook that coordinates async work with injected dependencies.
- If a hook dependency interface grows past roughly 8 to 10 fields, split the hook.

State rules:

- Orchestrators receive the state adapter, never import the concrete store directly.
- Swapping the client state library should require changing only the concrete store implementation and the state adapter.
- Concrete state manager implementations belong in library-specific reference files, not in the core Orc-BASH contract.

Orchestrator rule:

- If an orchestrator exceeds roughly 200 to 300 lines, split it or extract shared wiring into a factory/helper.

Component logic rule:

- Follow `<AI_DEV_SHOP_ROOT>/framework/operations/react-skill-operations.md` (React Component Rules) for component logic placement.

## Feedback and Failure Handling Contract

Do not model frontend failure handling as raw `Error | null` plus a timeout. In Orc-BASH, failures should be normalized before they reach the UI.

Use two feedback channels:

- `screen` feedback: persistent feedback for failures or warnings that affect the current screen or task
- `notification` feedback: transient feedback for success, lightweight warnings, or informational events

Responsibility split:

- API throws raw infra or transport failures.
- Business Logic may map domain failures into semantic app errors.
- Hook catches failures and normalizes them into stable UI-facing feedback.
- Orchestrator exposes the feedback contract.
- UI renders feedback consistently and does not invent failure semantics ad hoc.

Rendering defaults:

- Use persistent screen feedback for fetch failures, offline/auth/session issues, blocking validation, and incomplete/broken screen states.
- Use transient notifications for success and non-blocking notices.
- Use modals rarely, only for destructive confirmation, forced acknowledgement, or session recovery flows.
- Do not auto-dismiss blocking failures on a fixed timer.

For concrete type shapes and examples, load `references/typedoc-return-types-example.md`.

## When to Use

Use Orc-BASH when:

- multiple pages need the same hook logic
- cross-feature coordination is required
- business logic should be reusable across web and mobile surfaces
- state manager swap is a realistic future concern
- the team benefits from strict seams between UI, orchestration, state, API, and logic

Do not use Orc-BASH when:

- the feature is simple CRUD used in one place
- you are doing rapid throwaway prototyping
- the ceremony outweighs the reuse and testability benefits

Decision rule:

- max reusability plus minimal cross-layer coupling -> Orc-BASH
- speed and simplicity -> a smaller pattern such as a fusion hook

## Anti-Patterns

- Hook importing API modules, stores, or service implementations directly
- Orchestrator importing the concrete store instead of the state adapter
- Business logic importing from state
- Non-trivial business logic living in `views/*.tsx`
- Raw `Error | null` exposed as the UI contract
- Separate `error`, `warning`, `successOperation`, and `message` props instead of a structured feedback model
- Showing important failures only as 5-second toasts
- Broad `useEffect` dependencies such as the whole `deps` object
- Dependency-driven effects added without temporary non-production debug instrumentation during implementation
- `Use*Dependencies` growing without being treated as a split signal
- God orchestrators that accumulate multiple page concerns

## Compliance Checklist

- Hook receives all external dependencies via a typed `deps` interface.
- Hook does not import API, state, or logic implementations directly.
- Orchestrator receives the state adapter, not the concrete store.
- Orchestrator wiring is explicit for API calls, logic methods, and state actions.
- UI imports the orchestrator only.
- Exported layer boundaries have explicit return types and documentation.
- Feedback is normalized before it reaches the UI.
- `useEffect` and callback dependencies are stable and specific.

## References

- `references/feature-slice-drop-in-template.md` — minimal slice layout and drop-in starting point
- `references/typedoc-return-types-example.md` — explicit return types, TypeDoc, and feedback contract example
- `references/post-feature-example.md` — full six-layer feature example with a generic state-adapter boundary
- `references/state-manager-zustand.md` — concrete Zustand state store and adapter example
