# State Boundary Patterns

How to manage state across FSD slices without violating isolation rules. State management libraries and approaches are flexible choices — pick one per project, document it, and stay consistent.

## State Ownership by Layer

| Owner | What belongs here | Examples |
|-------|-------------------|----------|
| **Entity slice** (`model/`) | Domain read models, cached server data, normalized stores | User profile cache, product catalog, order history |
| **Feature slice** (`model/`) | Interaction state for the specific user action | Form values, optimistic mutation state, pending upload progress |
| **Widget** (local) | Composition-specific UI state | Accordion open/closed, tab selection within the widget |
| **App layer** (`providers/`, `store/`) | Cross-cutting state assembled from slices | Global theme, auth session, locale, toast queue |
| **Shared** | State utilities only — no business semantics | Generic store factory, persistence adapter, event bus primitives |

## Cross-Slice Communication Patterns

When multiple slices need access to the same state, choose one:

### Option A: Compose from Above (Inversion of Control)

A higher layer (page, widget, or app) reads state from one slice and passes it as props/context to another.

```text
page/checkout
  └─ reads entities/cart state
  └─ passes cart items as props to features/apply-coupon
```

**Tradeoffs:** Explicit data flow, easy to trace; can lead to prop threading in deep trees. Works well when the consuming slice needs only a subset of the source state.

### Option B: App-Level Composed Store

The `app` layer assembles a root store from slice-owned reducers/atoms/signals. Each slice exports its state piece through its public API; `app` wires them together.

```text
app/store/
  └─ combines entities/user/model/slice + features/cart/model/slice
```

**Tradeoffs:** Slices remain independent; app handles integration. Coupling is explicit at the wiring point. Works well for global state that many components read.

### Option C: Event Bus / Pub-Sub (Last Resort)

Slices emit domain events; other slices subscribe. No direct import between them.

```text
features/add-to-cart emits "item-added"
widgets/cart-icon subscribes to "item-added"
```

**Tradeoffs:** Maximum decoupling; hardest to trace and debug. Use only when the above options create unacceptable coupling or when slices are maintained by separate teams with different release cycles.

### Option D: Server/Session-Backed State

State lives on the server; slices read it through their own API segments. No client-side shared store needed.

**Tradeoffs:** Simplest client architecture; adds network latency to state reads. Works well for data that's already server-authoritative (auth, permissions, user preferences).

## Rules That Always Apply

Regardless of which pattern you choose:

- An entity never imports another entity's state directly (use compose-from-above or app-level composition)
- A feature never imports another feature's state
- `shared` never contains business-domain state — only generic utilities
- State shape exposed through `index.ts` is the public contract; internal store structure is private

## Decision Guide

```text
Is the state needed by only one slice?
  → Keep it internal to that slice's model/

Is it domain data used by multiple features/widgets?
  → Own it in the relevant entity; compose from above or via app store

Is it cross-cutting UI state (theme, locale, toasts)?
  → Own it in app layer; expose read access via shared hooks/utilities

Do slices need to react to each other without import coupling?
  → Event bus (document the event contracts)
```
