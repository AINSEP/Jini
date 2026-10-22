# CMS routing

`@jini-ai/cms/routing` owns the inverse resolver, named routes, forward phase registration and slug-capture slot extracted from Tovu routing (ADR-039; owner approved 2026-10-09).

Create one routing instance with host `isLive` and `reportPhaseError` ports. `urlFor` takes a projection of the host's existing content reader, not a new persistence owner. Bind one instance across Tovu composition roots to retain its historical process-wide owner replacement and teardown behavior. Other hosts can keep independent instances.

Every resolver/registration method takes a required object and optional object. Phase handlers retain the existing `(path, ctx)` callback protocol for compatibility. Named routes may be configured at construction; defaults remain `home` and `search`. All URL normalization, null behavior, unsafe schemes, phase order, fail/skip policy, snapshot iteration and capture identity semantics remain unchanged. Taxonomy and verified-origin integration are intentionally unchanged.

The original comments are preserved as historical rationale; references to module-level state now describe state within the host-bound instance. Visibility, including scheduled publication and Trash, stays with the host's existing policy owner; no wall clock or console is constructed in routing.

## Original routing rationale (verbatim)

# routing Overview

Owns the `RouteTarget` vocabulary and the routing contract v0 (ADR-039): the
inverse resolver Menus/SEO consume, the forward resolution pipeline's
registration seam Redirects will consume, and the `SlugChangeCapture` slot the
content write chokepoint calls on a slug-changing rename.

## Responsibilities

- Define the one `RouteTarget` union (`entryRef | termRef | url | route`) so
  Menus, SEO, and Redirects share a single vocabulary instead of each
  inventing their own.
- Resolve `RouteTarget`s to concrete paths/canonical URLs (`urlFor`) and
  active-state against a current path (`isActive`), workspace-scoped.
- Host the ordered, core-owned forward pipeline phase registry
  (`pre_content`/`post_content`) that Redirects registers into.
- Host the single named `SlugChangeCapture` registration slot the content
  chokepoint calls inside a rename transaction.

## Rules

- No Drizzle/SQLite adapter and no HTTP wiring live here — this is a
  library-layer build. Composition/wiring happens at the server composition
  root, not in this package.
- `entryRef` resolution reuses the existing `PostRepoPort`
  (`src/features/post/post.ts`); `post` is the only implemented content type,
  so this library introduces no new persistence port for it (rule-of-two).
- `termRef` resolution is a documented stub returning `null`. Taxonomy is not
  implemented in this repo, and ADR-029's Round-3 audit fold promoted the
  term-link schema question to a Wave-1 acceptance blocker (content-lib
  sign-off owed) — see the comment in `routing.ts`.
- `canonicalUrl` composition takes an `originOverride` string on
  `RouteResolveContext` instead of importing `src/origin` (ADR-040), which is
  being built in parallel and does not exist yet. This is a named TODO, not a
  finished integration.
- The forward pipeline's `resolve()` only runs the two registerable phases; the
  `content-resolve` step is fixed core content lookup and is out of scope here.
- The `SlugChangeCapture` slot may only ever be bound by core — no
  plugin-facing registration path exists (ADR-039 Round-2 amendment 1). The
  "absent binding must fail once link-preservation is enabled" invariant
  (Round-2 amendment 3) is NOT enforced by this library; it belongs to the
  content chokepoint + Redirects, neither of which exists yet.
- Public surface is the `index.ts` barrel only; deep imports into this
  library's internals are not supported.

## Future direction

- Full permalink-structure/route-table design is explicitly deferred
  (ADR-039 "Open") — v0 only ships the four things Menus/SEO/Redirects
  already depend on.
- `isActive` ancestor/prefix semantics (nested menu highlighting) and the
  `urlFor → null` caller-render contract are v0.1 work (ADR-039 "Open").
- Once `src/origin` (ADR-040) lands, `canonicalUrl` composition should read
  the verified origin from `OriginRegistryPort.canonicalOrigin(ctx)` instead
  of `RouteResolveContext.originOverride`.
- Once Redirects (ADR-033) is real, `pre_content`/`post_content` resolvers
  register through `registerResolvePhase`, and the `SlugChangeCapture` slot
  gets a real bound implementation from that library.
- Per ADR-039 §4's promotion trigger, the day a second in-tx participant
  alongside `SlugChangeCapture` is real (ADR-039's Round-3 fold already names
  Menus' binding-index write as that second participant), the single-slot
  model should be generalized into a small ordered core-only registry — a
  mechanical refactor, not a contract change.
