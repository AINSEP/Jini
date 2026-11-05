---
name: feature-slice-design
version: 2.0.0
last_updated: 2026-06-08
description: Feature-Sliced Design (FSD) — a framework-agnostic frontend architecture methodology with strict unidirectional layer imports, public API contracts per slice, and standardized decomposition into layers/slices/segments.
---

# Skill: Feature-Sliced Design (FSD)

Feature-Sliced Design is a frontend architecture methodology for structuring application code into standardized layers, business-domain slices, and technical segments. It enforces strict unidirectional dependencies and explicit public APIs at every slice boundary.

Use this skill for all frontend application architecture: React, Vue, Svelte, Angular, Solid, or plain TypeScript.

- Do not apply FSD to backend services, workers, APIs, CLIs, or domain-heavy server code.
- Do not apply FSD to libraries, backend-only projects, or trivial scripts.

## Hard Invariants vs Flexible Choices

FSD has exactly four non-negotiable rules. Everything else is a documented convention — choose what fits your project, stay consistent, and move on.

**Hard invariants (enforce always):**

1. Layer order is fixed — `app → pages → widgets → features → entities → shared`
2. Imports flow strictly downward — never sideways, never upward
3. Same-layer slices are isolated — a feature never imports another feature; an entity never imports another entity
4. Cross-slice access uses public APIs only — always import through `index.ts`

**Flexible choices (document your convention):**

- State management approach and placement
- Data-fetching strategy and library
- Test placement (co-located vs mirrored tree)
- Internal file naming within segments (e.g., `types.ts`, `schema.ts`, `contracts.ts`)
- Rendering boundary placement (server vs client)
- Framework routing integration strategy
- Whether to use `@x` cross-references or compose from above

When this skill presents multiple valid approaches, pick one per project and enforce consistency. The hard invariants are always checked; conventions are checked only against what the project documented.

## Core Model

FSD decomposes applications along three axes:

1. **Layers** — scope of responsibility (fixed vocabulary, strict order)
2. **Slices** — business-domain groupings within a layer
3. **Segments** — technical purpose groupings within a slice

### Layer Hierarchy

Layers are ordered from highest scope to lowest. Import direction is strictly top-down: a module may only import from layers below it, never sideways or upward.

```text
app  →  pages  →  widgets  →  features  →  entities  →  shared
───────────────────────────────────────────────────────────────→
                    strict import direction (top → down)
```

| Layer | Sliced? | Purpose |
|-------|---------|---------|
| **app** | No | Routing, providers, global styles, entrypoint, store config |
| **pages** | Yes | Full screens or routes; compose widgets and features |
| **widgets** | Yes | Self-contained UI blocks composing entities + features into meaningful sections |
| **features** | Yes | User-facing actions that deliver business value (verbs: "send comment", "add to cart", "filter results") |
| **entities** | Yes | Business domain objects the project operates on (nouns: user, product, order, notification) |
| **shared** | No | Reusable utilities detached from business specifics: UI kit, API client, libs, config, routes, i18n |

Not every layer is required. Most projects need at minimum: `shared`, `pages`, and `app`. Add layers only when they bring value.

### Segments

Each slice is subdivided by technical purpose:

| Segment | Purpose |
|---------|---------|
| `ui` | Components, styles, visual formatters |
| `model` | Data schemas, stores, business logic, validation |
| `api` | Backend interaction: request functions, response mappers |
| `lib` | Utility code needed by this slice |
| `config` | Feature flags, slice-specific configuration |

Segment naming rule: describe **purpose**, not essence.
- Forbidden segment folder names: `components`, `hooks`, `utils`, `helpers`, `containers`, `types`
- Correct segment folder names: `ui`, `model`, `api`, `lib`, `config`
- Files inside segments may use any clear name — `model/types.ts`, `model/store.ts`, `model/validation.ts` are all valid

The `model` segment may contain multiple concerns: type definitions, state management, business logic, validation, derived computations. Organize these as separate files within `model/` based on project complexity. There is no required internal file structure.

Custom segments are allowed (most commonly in `app` and `shared`) when they describe a clear purpose.

## Dependency Rules

1. **Strict unidirectional imports.** A module in a slice may only import from layers strictly below its own layer. Never import from the same layer or above.
2. **Same-layer isolation.** Slices on the same layer cannot import each other. A feature cannot import another feature. An entity cannot import another entity.
3. **Public API only.** Cross-slice imports must go through the slice's `index.ts` public API. Never import internal paths.
4. **`@x` escape hatch (entities only, last resort).** When entity A's data model inherently references entity B, use a narrow `@x` cross-reference file. Treat this as a necessary compromise, not a recommended approach.

### Avoiding Cross-Imports

When you feel the urge to import sideways:

1. **Merge slices** — if they always change together, they are one slice
2. **Push logic down** — move shared domain logic to the entities layer
3. **Compose from above (IoC)** — pass components/functions as props from pages/widgets
4. **Extract to shared** — if truly business-agnostic, move to shared layer

## Public API Contract

Every slice exports through a single `index.ts` at its root. This is the only import path external consumers may use.

Rules:
- Explicit named exports only — each export is individually named and sourced
- No wildcard re-exports (`export * from ...` is prohibited)
- Same-slice imports use relative paths to internal files (never import from your own index)
- Cross-slice imports use absolute paths via aliases (e.g., `@/entities/user`)

Exception for `shared/ui` collections: use per-component index files to avoid bundle bloat:
```
shared/ui/button/index.ts
shared/ui/text-field/index.ts
```

## Decomposition Heuristic

When deciding where something belongs:

- **Nouns** → entities (`user`, `product`, `order`)
- **Verbs** → features (`add-to-cart`, `send-comment`, `toggle-theme`)
- **Compositions** → widgets (combines entity display + feature actions)
- **Screens** → pages (full route-level views)
- **Shared utilities** → shared (no business semantics)

Start from pages and extract downward. Do not pre-slice speculatively.

## Framework Integration

File-based routing frameworks (Next.js, Nuxt, SvelteKit, Astro) reserve directory names that collide with FSD layers (`app/`, `pages/`). Valid resolution strategies:

| Strategy | Approach | Tradeoff |
|----------|----------|----------|
| **Thin route shell** | Framework routing directory contains only thin re-exports/controllers; FSD code lives under `src/` | Cleanest separation; requires mental mapping between route files and FSD pages |
| **Prefix/rename** | Rename FSD layers to avoid collisions (`_pages/`, `views/`, `core/`) | Avoids filesystem conflicts; deviates from canonical FSD naming |
| **Framework-as-controller** | Treat the framework's routing directory as both the controller and FSD app/pages layer | Feels native to the framework; mixes routing config with composition |
| **Flat FSD in src/** | All FSD layers live under `src/`; framework routing at project root delegates inward | Clear boundary; framework route files act as the "pages" entry point |

Pick one strategy per project. Framework route files should remain thin — routing, metadata, loaders/actions, serialization — then delegate to FSD page/widget/feature code for actual UI and logic.

## Enforcement

### Agent-Checkable Rules

Before handoff, verify:

1. No import crosses upward or sideways (grep for imports violating layer order)
2. Every slice has an `index.ts` with explicit named exports
3. No internal path is imported from outside its slice
4. Segment folders use approved names (`ui`, `model`, `api`, `lib`, `config`)
5. No slice contains code belonging to a different layer's responsibility

### Steiger Linter

The official FSD linter is [Steiger](https://github.com/feature-sliced/steiger). Key rules it enforces:

- `no-cross-imports` — forbids same-layer slice imports
- `no-public-api-sidestep` — forbids importing internal slice paths
- `insignificant-slice` — flags slices used on a single page only (candidate for merge)
- `excessive-slicing` — identifies over-granular slicing

When the project uses Steiger, run it as part of the test/lint gate.

## When to Use

- Frontend applications of any framework
- Projects large enough that team members struggle with coupling
- When modifications frequently break unrelated parts
- Growing teams needing shared architectural vocabulary
- When you expect the project to scale in features or contributors

## When NOT to Use

- Libraries (not applications)
- Small prototypes or throwaway experiments
- Purely backend code
- Current architecture is working fine and not causing problems
- One-off CRUD surfaces with no reuse horizon

## Load Strategy

Read this file for the contract and rules. Open references only when needed:

- `references/layer-hierarchy-reference.md` — detailed layer descriptions with decision examples
- `references/framework-neutral-examples.md` — concrete slice implementations across frameworks
- `references/public-api-patterns.md` — barrel export patterns, anti-patterns, and `@x` cross-reference
- `references/framework-integration-patterns.md` — routing collision strategies per framework
- `references/state-boundary-patterns.md` — cross-slice state management options with tradeoffs
- `references/data-flow-patterns.md` — data-fetching ownership, loading states, generated clients
- `references/rendering-boundaries.md` — server/client/hydration boundary concepts
- `references/testing-placement.md` — co-located vs mirrored test strategies
