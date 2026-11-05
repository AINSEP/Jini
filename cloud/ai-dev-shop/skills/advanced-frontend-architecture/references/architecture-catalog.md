# Frontend Architecture Catalog

Use this catalog to build candidate sets for `advanced-frontend-architecture`.
It is a selector reference, not an implementation guide. Score composed
candidates that match the project context; do not treat every entry as a rival
at the same architectural layer.

## Composition Model

Frontend architecture choices usually compose across four layers:

| Layer | Examples | Decides |
|---|---|---|
| Runtime/rendering | SPA, SSG, SSR/hybrid, framework-native routing | Initial render, hydration, route data, SEO/perf baseline |
| App topology | Single app, modular monolith, micro-frontends | Deploy boundary, ownership, release independence |
| Data/I/O | REST/RPC, BFF, GraphQL/tRPC, server loaders/actions | Request shape, backend coupling, cache/mutation boundary |
| Internal organization | Framework-native, DDD, vertical slices, FSD, hexagonal, orchestration/Orc-BASH, article stack | Folder structure, import direction, state/business-rule placement |

Build 2-4 candidates by composing layers. Example:

`SSR/hybrid + modular monolith + BFF + vertical slices`

## Runtime and Topology Candidates

### Static / SSG

Pre-built HTML served from a CDN. Best for content-heavy, low-interactivity
surfaces.

- Strong when: docs, marketing, blogs, catalogs with infrequent updates.
- Weak when: user-generated content, dashboards, real-time collaboration,
  personalization.
- Transition: move to SSR/hybrid when interactivity or personalization grows.

### SPA

Single HTML shell rendered in the browser. Best for rich internal tools where
SEO and first paint are not primary constraints.

- Strong when: admin panels, dashboards, authenticated internal tools.
- Weak when: SEO-critical content, slow networks, low-powered devices.
- Transition: add SSR/hybrid when initial-load or SEO pressure rises.

### SSR / Hybrid

Server-rendered initial HTML with route-by-route static, server, and client
rendering choices. Examples include Next.js, Nuxt, SvelteKit, Remix, and Astro
hybrid.

- Strong when: content plus interactivity, e-commerce, SaaS marketing/product
  blends, mixed public/authenticated surfaces.
- Weak when: pure internal tools, offline-first apps, or highly dynamic
  real-time UIs where server render adds little value.
- Watch: hydration cost, server/client state split, framework impedance.

### Modular Frontend Monolith

One deployable frontend with enforced internal module or domain boundaries.

- Strong when: one product, growing team, shared release train, need for
  stronger boundaries before micro-frontends are justified.
- Weak when: truly autonomous product teams need independent deploys.
- Common internal patterns: FSD, vertical slices, DDD module boundaries,
  dependency-cruiser or ESLint boundaries.

### Micro-frontends

Multiple independently built/deployed frontend applications composed into one
experience.

- Strong when: large org, autonomous teams, independent deployment is worth
  runtime and operational complexity.
- Weak when: small teams, startups, tightly coupled product surfaces, MVPs.
- Watch: duplicate dependencies, version skew, shared state, design-system
  governance, shell failure modes.

### BFF / GraphQL / tRPC Data Layer

A complementary data layer, not a competing macro architecture.

- Strong when: frontend needs aggregate data across services, mobile/web share
  a data contract, backend release cycles block frontend iteration.
- Weak when: simple CRUD against one backend, prototypes, small teams.
- Score it as part of a composed candidate, not as a rival to FSD or vertical
  slices.

## Internal Organization Candidates

### Framework-native

Use the framework's idioms without adding a branded architecture.

| Framework | Native organization signals |
|---|---|
| React | Route/app conventions, colocated components/hooks, server-state library, local composition |
| Angular | Standalone components or feature modules, services via DI, route-level boundaries |
| Vue/Nuxt | SFCs, composables, Pinia where needed, route/page conventions |
| Svelte/SvelteKit | Route groups, load functions, stores, module scripts |
| Plain TypeScript | ES modules, explicit dependency injection, small domain-neutral libraries |

- Strong when: small team, simple CRUD/admin, short lifespan, low domain
  complexity.
- Weak when: cross-team ownership, complex business rules, multi-framework
  shared core, long-lived platform.
- Revisit trigger: repeated cross-feature imports, duplicated business rules,
  hard-to-test state transitions, or unclear placement decisions.

### DDD / Domain Modeling

Use bounded contexts, domain vocabulary, pure domain rules, and explicit domain
ownership in the frontend where the frontend owns meaningful business behavior.

- Strong when: UI enforces real business rules, workflows have invariants,
  multiple contexts use shared vocabulary, or offline/client-side decisions must
  be testable.
- Weak when: frontend is mostly forms over backend CRUD or domain logic belongs
  entirely server-side.
- Often composed with: vertical slices, hexagonal ports/adapters, article stack.

### Vertical Slices

Organize by user capability or workflow rather than horizontal folders like
`components/`, `hooks/`, and `services/`.

- Strong when: features change together, teams own capabilities, local cohesion
  matters more than shared technical layers.
- Weak when: slices are tiny and numerous, duplication pressure is high, or no
  boundary enforcement exists.
- Guard: cross-slice internals are private; shared needs move to domain/shared
  APIs.

### Feature-Sliced Design (FSD)

Use standardized layers such as `app`, `pages`, `widgets`, `features`,
`entities`, and `shared`, with public APIs and unidirectional imports.

- Strong when: medium-large frontend, shared team vocabulary, predictable
  placement, linter-enforced boundaries.
- Weak when: small apps, prototypes, teams unwilling to adopt the vocabulary, or
  frameworks whose native structure fights the FSD layer model.
- Implementation reference: `skills/feature-slice-design/SKILL.md`.

### Hexagonal Frontend

Keep framework-free core/domain/use cases behind ports and adapters. UI and
infrastructure depend inward; domain does not import the framework, fetch,
stores, or component libraries.

- Strong when: business rules need isolated tests, API/backend may change,
  multi-surface or multi-framework sharing is plausible.
- Weak when: all logic is UI-only, backend owns all invariants, or ceremony
  exceeds likely payoff.
- Often composed with: DDD, vertical slices, article stack.

### Orchestration / Orc-BASH

Separate wiring from business logic, API calls, state management, hooks or
framework reactivity, and UI presentation.

- Framework-neutral concept: an orchestration layer wires pure logic, adapters,
  state, and UI-facing view models/composables/services.
- React-specific implementation: Orc-BASH in
  `skills/frontend-react-orcbash/SKILL.md`.
- Strong when: the same logic feeds multiple pages/components, state/API seams
  need strict tests, or adapter swapping matters.
- Weak when: a single component owns a simple local interaction.
- Gate: do not recommend `frontend-react-orcbash` for Angular, Vue, or Svelte.
  Translate orchestration into native services/composables/stores for those
  frameworks.

### Article Stack: Pure Core + Mirrored UI + Guards

Named recipe from the user's article. It composes:

1. DDD vocabulary and bounded contexts.
2. Framework-free `modules/<domain>/` core.
3. Hexagonal ports/adapters for I/O.
4. Vertical slices for user actions/use cases.
5. Mirrored `ui/<framework>/<domain>/<slice>/` presentation tree when multiple
   reactivity paradigms exist.
6. Orchestration layer that wires UI to use cases, state, and adapters.
7. Boundary guards in lint/CI.

Strong when:

- Domain-heavy frontend needs testable framework-free core.
- Multiple frameworks or reactivity paradigms must share logic.
- Long-lived product has more than one surface and real boundary risk.
- Team can maintain import guards and handoff discipline.

Weak when:

- Simple CRUD/admin or prototype.
- Single small React/Vue/Svelte app with no shared core pressure.
- Framework-native route/data conventions are enough.
- No one will enforce the boundary rules.

Confidence note: treat this as a composed recipe. It can win when its concerns
are actually present; do not select it for novelty alone.

## Quick Candidate Selection

| Context | Candidate set to start with |
|---|---|
| Small CRUD/admin, one team | Framework-native; maybe SPA + native routing |
| Internal dashboard with moderate state | SPA or SSR/hybrid + framework-native or vertical slices |
| Domain-heavy single framework | DDD + vertical slices; FSD if team vocabulary/enforcement matters |
| React app with justified state/API/orchestration seams | Vertical slices or FSD + React Orc-BASH for selected domains |
| Multi-framework shared core | Article stack; hexagonal frontend + mirrored UI |
| Medium-large team, one deployable | Modular monolith + FSD or vertical slices |
| Many autonomous teams requiring independent deploy | Micro-frontends + design-system governance |
| Complex backend aggregation | Add BFF/GraphQL/tRPC to the chosen runtime/topology candidate |
| Brownfield with existing conventions | Existing convention + migration path; score migration cost heavily |

## Candidate Anti-patterns

| Candidate | Avoid when |
|---|---|
| Framework-native only | Domain rules are duplicated, imports sprawl, or multiple teams need boundaries |
| FSD | App is tiny, team rejects vocabulary, or framework-native structure would be clearer |
| Vertical slices | No guardrails exist and slices need many shared internals |
| Hexagonal frontend | Frontend has little domain behavior and all invariants are server-owned |
| Orc-BASH | Framework is not React, or there are no orchestration/state/API seams |
| Article stack | No multi-framework/shared-core/domain-heavy pressure exists |
| Micro-frontends | Independent deploys are not worth runtime and platform cost |
| BFF/GraphQL | A single simple backend already serves the UI well |

## Baseline Fit Signals

Use these as starting priors, not final scores.

| Candidate | Best signals | Weak signals |
|---|---|---|
| Framework-native | simplicity, low ceremony, ecosystem fit | weak boundary enforcement |
| DDD/domain modeling | domain fit, testable rules | ceremony for CRUD |
| Vertical slices | cohesion, team autonomy | duplication risk |
| FSD | legibility, enforcement, shared vocabulary | learning curve, rigidity |
| Hexagonal frontend | coupling control, testability | ceremony, adapter overhead |
| Orchestration/Orc-BASH | explicit seams, reuse, testability | React-specific implementation risk |
| Article stack | multi-framework core, long-term boundaries | split tree and guard overhead |
| Modular monolith | team scaling with one deployable | all-or-nothing releases |
| Micro-frontends | deploy autonomy | high platform/runtime cost |
