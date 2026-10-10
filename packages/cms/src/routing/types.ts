/**
 * @file Core type definitions for the Tovu `routing` Tier-2 library (ADR-039 v0).
 *
 * Purpose:
 * Declares the `RouteTarget` vocabulary, the workspace-scoped resolve context,
 * the inverse-resolver result shape, the forward resolution pipeline's phase
 * vocabulary, and the `SlugChangeCapture` slot's payload shape. This is the one
 * place `entryRef | termRef | url | route` is defined — promoted from
 * Menus-local (ADR-029 §3) to routing-owned per ADR-039 §3, so Menus/SEO/
 * Redirects share one vocabulary instead of inventing three.
 *
 * How it relates to the project:
 * - `core/ports.ts` supplies the shared primitives (`UUID`, `ISODateTime`, …).
 * - `routing/ports.ts` declares the dependency shape `urlFor`/`isActive` need
 *   (the existing `PostRepoPort`, reused rather than duplicated).
 * - `routing/routing.ts` implements the resolve functions against these types.
 *
 * Architectural role:
 * INTERFACES + TYPES ONLY (no feature logic). ADR-039 v0 is deliberately the
 * minimal shape three other sections depend on; full permalink-structure
 * design is explicitly deferred (ADR-039 "Open").
 */
import type { JsonObject, UUID } from "@jini-ai/core/primitives";

// ---------------------------------------------------------------------------
// RouteTarget vocabulary (ADR-039 §3)
// ---------------------------------------------------------------------------

/** Discriminant values for {@link RouteTarget}. */
export type RouteTargetKind = "entryRef" | "termRef" | "url" | "route";

/**
 * A link to a content entry by id. Only `post` has a real resolver in this
 * repo today (ADR-039 v0); `contentType` is accepted for forward-compat with
 * future content types but is not required to resolve a post reference.
 */
export interface EntryRefTarget {
  readonly kind: "entryRef";
  readonly entryId: UUID;
  readonly contentType?: string;
}

/**
 * A link to a taxonomy term (category/tag archive).
 *
 * NOT resolvable today: taxonomy isn't implemented in this repo, and ADR-029's
 * Round-3 audit fold promoted "term-link schema" from an Open item to an
 * explicit Wave-1 acceptance blocker — ADR-022 §5's `entry_refs` covers
 * entry-to-entry references only, with no term-target schema yet (content-lib
 * sign-off owed). `urlFor`/`isActive` resolve every `termRef` target to `null`
 * until that schema lands; see the stub in `routing.ts`.
 */
export interface TermRefTarget {
  readonly kind: "termRef";
  readonly termId: UUID;
  readonly taxonomy: string;
}

/**
 * An external or site-relative URL, passed through as given (scheme-validated:
 * `javascript:`/`data:` are rejected and resolve to `null`, mirroring the
 * "unavailable → null" contract rather than throwing).
 */
export interface UrlTarget {
  readonly kind: "url";
  readonly href: string;
}

/** A named core route (e.g. `home`, `search`), resolved via the route registry. */
export interface RouteRefTarget {
  readonly kind: "route";
  readonly route: string;
  /** Optional static params; unused by the v0 registry, reserved for v0.1 param interpolation. */
  readonly params?: JsonObject;
}

/** v0 discriminated union of route targets (ADR-039 §3). */
export type RouteTarget = EntryRefTarget | TermRefTarget | UrlTarget | RouteRefTarget;

// ---------------------------------------------------------------------------
// Resolve context + inverse-resolver result (ADR-039 §2, Round-2 amendment 4)
// ---------------------------------------------------------------------------

/**
 * Workspace-scoped context threaded through every resolve call. `siteId`/
 * `locale`/`originKey` are reserved for multi-site/i18n v0.1 work (ADR-039
 * "Open"); only `workspaceId` is load-bearing today.
 *
 * `originOverride` is a stand-in for `core/origin` (ADR-040), which is being
 * built in parallel and does not exist yet. Once it lands, `canonicalUrl`
 * composition should read the verified origin from
 * `OriginRegistryPort.canonicalOrigin(ctx)` instead of this field.
 */
export interface RouteResolveContext {
  readonly workspaceId: UUID;
  readonly siteId?: string;
  readonly locale?: string;
  readonly originKey?: string;
  /**
   * TODO(ADR-040): compose canonicalUrl from OriginRegistryPort.canonicalOrigin(ctx)
   * once src/origin exists. Until then, a caller that knows the verified origin
   * may pass it here; absent, canonicalUrl falls back to the relative path.
   */
  readonly originOverride?: string;
}

/** Result of a successful inverse resolve — the shape Menus/SEO consume. */
export interface RouteUrl {
  readonly path: string;
  readonly canonicalUrl: string;
}

// ---------------------------------------------------------------------------
// Forward resolution pipeline (ADR-039 §1) — registration vocabulary
// ---------------------------------------------------------------------------

/**
 * The two registerable phases of the forward pipeline
 * (`normalize → pre_content → content-resolve → post_content → 404`).
 * `content-resolve` is fixed core content lookup and is not a registerable
 * phase of this library; it is out of scope for ADR-039 v0's registration
 * mechanism.
 */
export type RouteResolvePhaseName = "pre_content" | "post_content";

/** Terminal decision a phase resolver may return; anything else falls through. */
export type RouteResolvePhaseOutcome =
  | { readonly kind: "redirect"; readonly location: string; readonly statusCode: number }
  | { readonly kind: "resolved"; readonly path: string }
  | { readonly kind: "not_found" };

/**
 * A single phase resolver. Returns `null` to fall through to the next
 * registered resolver in the same phase (and eventually the next phase);
 * returns an outcome to short-circuit the pipeline (ADR-039 §1 invariant:
 * `pre_content` may only redirect/gone, never turn a resolvable live path
 * into a 404 — Round-2 amendment 5).
 */
export type RouteResolvePhaseHandler = (
  path: string,
  ctx: RouteResolveContext
) => Promise<RouteResolvePhaseOutcome | null>;

/** Final outcome of {@link resolve} after all phases have run. */
export type RouteResolveResult =
  | { readonly matched: false }
  | {
      readonly matched: true;
      readonly phase: RouteResolvePhaseName;
      readonly outcome: RouteResolvePhaseOutcome;
    };

// ---------------------------------------------------------------------------
// SlugChangeCapture slot (ADR-039 §4 + Round-2/Round-3 amendments)
// ---------------------------------------------------------------------------

/** Payload handed to the bound {@link SlugChangeCapture} inside the rename transaction. */
export interface SlugChangeCaptureInput {
  readonly workspaceId: UUID;
  readonly entryId: UUID;
  readonly oldPath: string;
  readonly newPath: string;
  readonly actor: UUID;
  readonly changeSetId?: UUID;
}

/**
 * The single named slot content's write chokepoint calls inside the rename
 * transaction (ADR-039 §4). Declared here by routing (content knows nothing of
 * redirects); implemented by the redirects library; wired by the composition
 * root. **No slot implementation may be plugin-supplied** (Round-2 amendment 1
 * — the slot is core-resident by definition).
 *
 * Constraints on any bound implementation (Round-2 amendment 2): idempotent by
 * `changeSetId`, no external I/O, no in-tx publish (an outbox row may be
 * written in-tx per the transactional-outbox pattern, but dispatch happens
 * post-commit), and a strict lock order of content row before redirect rows.
 *
 * Fail-closed nuance (Round-2 amendment 3, not enforced by this library):
 * absent binding is a no-op only before Redirects is installed, or while
 * slug-preservation is disabled for the workspace. Once link-preservation is
 * enabled, a slug-changing rename with no bound capture MUST fail
 * `LINK_PRESERVATION_UNAVAILABLE` rather than silently skip the redirect. That
 * enforcement belongs to the content write chokepoint (which knows whether
 * preservation is enabled) and to Redirects (which doesn't exist yet in this
 * repo) — this library only exposes the registration slot.
 */
export interface SlugChangeCapture {
  onSlugChange(input: SlugChangeCaptureInput): Promise<void>;
}
