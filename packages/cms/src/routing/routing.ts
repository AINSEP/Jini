/**
 * @file Resolution logic for the host `routing` Tier-2 library (ADR-039 v0).
 *
 * Purpose:
 * Implements the inverse resolver (`urlFor`/`isActive`) Menus (ADR-029) and
 * SEO (ADR-032) consume, the forward resolution pipeline registration seam
 * Redirects (ADR-033) will consume, the named-route registry backing `route`
 * targets, and the `SlugChangeCapture` registration slot (ADR-039 §4).
 *
 * How it relates to the project:
 * - `routing/types.ts` supplies the `RouteTarget` vocabulary and result shapes.
 * - `routing/ports.ts` supplies `RouteResolverDeps` (reuses `PostRepoPort`).
 * - Only `post` is a real implemented content type today, so `entryRef`
 *   resolution goes through `PostRepoPort` directly; `termRef` is a documented
 *   stub (taxonomy doesn't exist yet — ADR-029 Round-3 fold item 1).
 *
 * Architectural role:
 * Core-owned Tier-2 library code. No Drizzle/SQLite adapter and no HTTP
 * wiring live here (that is out of scope for this v0 build) — this file is
 * pure resolution logic over injected ports and in-module registries.
 */
import type { RouteResolverDeps, RoutingContentRecord, RoutingPorts } from './ports.js';
import type { EntryRefTarget, RouteRefTarget, RouteResolveContext, RouteResolvePhaseHandler, RouteResolvePhaseName, RouteResolvePhaseOutcome, RouteResolveResult, RouteTarget, RouteUrl, SlugChangeCapture, TermRefTarget, UrlTarget } from './types.js';

/** Raised when a `RouteTarget` carries a discriminant this library does not recognize. */
export class RouteResolutionError extends Error {}

export interface RegisterNamedRouteInput {
  readonly name: string;
  readonly path: string;
}

// ---------------------------------------------------------------------------
// Inverse resolver — `urlFor` / `isActive` (ADR-039 §2, Round-2 amendment 4)
// ---------------------------------------------------------------------------

export interface UrlForRequired {
  deps: RouteResolverDeps;
  target: RouteTarget;
  ctx: RouteResolveContext;
}

export interface UrlForOptional {}

export interface IsActiveRequired {
  deps: RouteResolverDeps;
  target: RouteTarget;
  currentPath: string;
  ctx: RouteResolveContext;
}

export interface IsActiveOptional {}

// ---------------------------------------------------------------------------
// Forward resolution pipeline (ADR-039 §1) — registration seam for Redirects
// ---------------------------------------------------------------------------

/**
 * One handler plus the registrant that owns it. `owner` is an opaque identity
 * token supplied by the registrant (see {@link RegisterResolvePhaseOptions.owner});
 * `undefined` means "unowned", the historical append-only behavior. `onError`
 * is this registration's own fault policy — see {@link RegisterResolvePhaseOptions.onError}.
 */
interface PhaseRegistration {
  readonly owner: unknown;
  readonly handler: RouteResolvePhaseHandler;
  readonly onError: "skip" | "fail";
}

type PhaseRegistry = Record<RouteResolvePhaseName, PhaseRegistration[]>;

export interface RegisterResolvePhaseOptions {
  /**
   * The registrant's identity. Registering under an owner that already holds
   * handlers in this phase REPLACES them rather than appending, so a registrant
   * whose handlers close over a per-boot resource (a site's database handle, a
   * request-scoped client) cannot leave the previous boot's closures reachable.
   *
   * Omit it and the registration is appended and never superseded — the v0
   * behavior this library's own tests still use.
   */
  readonly owner?: unknown;
  /**
   * This registration's fault policy when its handler throws. `"fail"` (the default) rethrows
   * out of the phase, so the caller's own error handling runs (the public site routes answer
   * `500 <h1>Site error</h1>`, on BOTH phases as of 2026-09-16, t91 F4.3-A: `post_content` on
   * `GET /:slug` used to leave a default-policy throw with no response at all — see
   * `routes/site/pages.ts`'s `handlePostNotFoundInSlugCatch`). `"skip"` logs `[routing] a <phase>
   * resolver failed for <path> — skipping it` and continues to the phase's remaining handlers.
   *
   * Choose `"skip"` only for a handler whose failure can only DECLINE an outcome — it can never
   * fabricate one, so a swallowed failure cannot weaken any guard. Redirects opts into it for
   * exactly that reason (INV-03: a lookup failure means "no redirect", never "gone"). A future
   * guard-type handler (a takedown or reserved-path check, which must BLOCK on failure, not wave
   * a request through) fails CLOSED by default unless it deliberately opts into `"skip"` too.
   */
  readonly onError?: "skip" | "fail";
}

export interface ResolveInput {
  path: string;
  ctx: RouteResolveContext;
}

export interface ResolveRequired {
  input: ResolveInput;
}

export interface ResolveOptional {}
export type EmptyOptions = Record<string, never>;
export interface CreateRoutingRequired { readonly ports: RoutingPorts }
export interface CreateRoutingOptional { readonly namedRoutes?: ReadonlyArray<readonly [string, string]> }

/** Bound routing API. All methods share one instance's registrations and host ports. */
export interface Routing {
  entryPublicPath(required: { post: RoutingContentRecord; ctx: RouteResolveContext }, optional?: EmptyOptions): RouteUrl | null;
  postPublicPath(required: { slug: string }, optional?: EmptyOptions): string;
  getNamedRoute(required: { name: string }, optional?: EmptyOptions): string | null;
  registerNamedRoute(required: RegisterNamedRouteInput, optional?: EmptyOptions): void;
  urlFor(required: UrlForRequired, optional?: UrlForOptional): Promise<RouteUrl | null>;
  isActive(required: IsActiveRequired, optional?: IsActiveOptional): Promise<boolean>;
  resolve(required: ResolveRequired, optional?: ResolveOptional): Promise<RouteResolveResult>;
  registerResolvePhase(required: { phase: RouteResolvePhaseName; resolver: RouteResolvePhaseHandler }, optional?: RegisterResolvePhaseOptions): () => void;
  unregisterResolvePhaseOwner(required: { owner: unknown }, optional?: EmptyOptions): void;
  runPreContentPhase(required: { path: string; ctx: RouteResolveContext }, optional?: EmptyOptions): Promise<RouteResolvePhaseOutcome | null>;
  runPostContentPhase(required: { path: string; ctx: RouteResolveContext }, optional?: EmptyOptions): Promise<RouteResolvePhaseOutcome | null>;
  registerSlugChangeCapture(required: { impl: SlugChangeCapture }, optional?: EmptyOptions): () => void;
  getSlugChangeCapture(required: EmptyOptions, optional?: EmptyOptions): SlugChangeCapture | undefined;
  /** Test-only reset of this instance; never resets another instance's registrations. */
  resetRoutingRegistrationsForTests(required: EmptyOptions, optional?: EmptyOptions): void;
}

/**
 * Create routing over host-owned content visibility and fault reporting.
 * Each instance owns its registrations; a host that historically shared one process registry
 * must bind one instance and reuse it across composition roots. No database or clock is constructed.
 * @param required Host ports; visibility errors propagate unchanged.
 * @param optional Initial named-route configuration (home/search by default).
 * @returns Resolvers and registration lifecycles sharing this instance's state.
 * @complexity O(r) initialization for r configured named routes.
 * @example const routing = createRouting({ ports }, { namedRoutes: [['home', '/']] });
 */
export function createRouting(required: CreateRoutingRequired, optional: CreateRoutingOptional = {}): Routing {

  // ---------------------------------------------------------------------------
  // Named-route registry (backs `route` targets — ADR-039 §3)
  // ---------------------------------------------------------------------------

  const DEFAULT_NAMED_ROUTES: ReadonlyArray<readonly [string, string]> = [
    ["home", "/"],
    ["search", "/search"],
  ];

  const initialNamedRoutes = optional.namedRoutes ?? DEFAULT_NAMED_ROUTES;
  const namedRoutes = new Map<string, string>(initialNamedRoutes);

  /**
   * Register (or overwrite) a named core route. Core-owned registration, not an
   * open plugin hook — matches ADR-039 §1's treatment of the forward pipeline.
   *
   * @complexity O(1) time/space.
   */
  function registerNamedRoute(input: RegisterNamedRouteInput, _optional: EmptyOptions = {}): void {
    namedRoutes.set(input.name, input.path);
  }

  /**
   * Look up a named route's fixed path.
   *
   * @returns the registered path, or `null` if `name` has no registration
   * (mirrors the library-wide "unavailable → null" contract).
   * @complexity O(1) time/space.
   */
  function getNamedRoute({ name }: { name: string }, _optional: EmptyOptions = {}): string | null {
    return namedRoutes.get(name) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Path normalization + canonical URL composition
  // ---------------------------------------------------------------------------

  const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

  function isAbsoluteUrl(value: string): boolean {
    return ABSOLUTE_URL_PATTERN.test(value) || value.startsWith("//");
  }

  /**
   * Normalize a request/target path: strip query/hash, force a leading slash,
   * and drop a trailing slash (except for the root path itself).
   *
   * @complexity O(n) in path length.
   */
  function normalizePath(rawPath: string): string {
    const withoutQueryOrHash = rawPath.split(/[?#]/)[0] ?? "";
    const withLeadingSlash = withoutQueryOrHash.startsWith("/")
      ? withoutQueryOrHash
      : `/${withoutQueryOrHash}`;
    if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
      return withLeadingSlash.slice(0, -1);
    }
    return withLeadingSlash;
  }

  /**
   * Builds a post/page's own public path from its `slug` — the one point every call site that turns a
   * `PostRecord.slug` into a route string goes through, so the content-owned-homepage `"/"` root-slug
   * exception (`post.ts`'s `ROOT_SLUG`) has exactly one implementation instead of N independently
   * re-deriving it. `/${slug}` is correct for every ordinary slug; the one deliberate exception is the
   * literal `"/"` slug itself, which a naive `/${slug}` template would double up into `"//"` — a Page
   * that has claimed the site's own homepage (`post.ts`'s `ROOT_SLUG` doc has the write-time gate that
   * makes `"/"` the only slug this can ever matter for).
   *
   * @complexity O(1).
   */
  function postPublicPath({ slug }: { slug: string }, _optional: EmptyOptions = {}): string {
    return slug === "/" ? "/" : `/${slug}`;
  }

  /**
   * Compose the `canonicalUrl` a resolved `path` implies.
   *
   * TODO(ADR-040): compose canonicalUrl from OriginRegistryPort.canonicalOrigin(ctx)
   * once `src/origin` exists, instead of `ctx.originOverride`. `src/origin` is
   * being built in parallel by another agent and does not exist yet, so this
   * library must not import it.
   *
   * @complexity O(1).
   */
  function composeCanonicalUrl(path: string, ctx: RouteResolveContext): string {
    if (isAbsoluteUrl(path)) return path;
    const origin = ctx.originOverride?.replace(/\/$/, "");
    return origin ? `${origin}${path}` : path;
  }

  // ---------------------------------------------------------------------------
  // Per-kind target resolvers (internal — dispatched by `urlFor`)
  // ---------------------------------------------------------------------------

  /**
   * `published` is the only status that yields a live, linkable path (mirrors `getPublishedPostBySlug`,
   * `post.ts`). Checks `isTrashed` too, not just `status` — `softDelete` (post.ts) stamps only
   * `deletedAt`/`updatedAt`/`version`, never `status`, so a post that was `published` when trashed
   * stays `status: "published"` forever, and `postRepo.findById` (this module's `resolveEntryRefTarget`
   * and every other caller of {@link entryPublicPath}) is documented trash-BLIND. Without this check a
   * trashed post would resolve to a live, linkable URL through `urlFor`/menu href resolution
   * (`resolveStaticMenusForRender`, `server/inbound/public-http/routes/site/pages.ts`) even though the
   * post itself 404s at every real render entrypoint. Same defect pattern as
   * caa116115c103630ba5253f9bbe3bceb234347d8 (sitemap.xml/llms.txt) and a5c9bac8 (media rendition
   * gating).
   */
  function isPublished(post: RoutingContentRecord): boolean {
    // Scheduled publishing (2026-10-05): a published row whose `publishAt` is still ahead gets no
    // live link yet either — `isLiveAt` is `status === "published" && !isTrashed` plus that check.
    return required.ports.isLive({ post });
  }

  /**
   * Pure half of `entryRef` resolution: given a `PostRecord` already in hand, decides its public path
   * with no repo call of its own. Factored out of {@link resolveEntryRefTarget} (and exported) so a
   * caller that already holds the record — e.g. `features/post/tool-registrations.ts`'s
   * `content_post_list`, iterating rows a prior `postRepo.list()` already fetched — can resolve
   * `publicUrl` without a redundant `postRepo.findById` per row. `resolveEntryRefTarget`/`urlFor`
   * still call this internally, so a caller resolving by id and a caller resolving from an
   * already-held record always compute the identical path/canonicalUrl — the one-resolver property
   * SEO's canonical tags depend on is unchanged.
   *
   * @returns `null` for a draft, unpublished, or otherwise non-live row — never a link a visitor
   * would 404 on.
   * @complexity O(1).
   */
  function entryPublicPath(
    { post, ctx }: { post: RoutingContentRecord; ctx: RouteResolveContext },
    _optional: EmptyOptions = {}
  ): RouteUrl | null {
    if (!isPublished(post)) return null;
    const path = postPublicPath({ slug: post.slug });
    return { path, canonicalUrl: composeCanonicalUrl(path, ctx) };
  }

  async function resolveEntryRefTarget(
    deps: RouteResolverDeps,
    target: EntryRefTarget,
    ctx: RouteResolveContext
  ): Promise<RouteUrl | null> {
    const post = await deps.postRepo.findById({ workspaceId: ctx.workspaceId, id: target.entryId });
    if (!post) return null;
    return entryPublicPath({ post: post, ctx: ctx });
  }

  /**
   * Stub: taxonomy isn't implemented in this repo. ADR-029's Round-3 audit fold
   * promoted "term-link schema" from an Open item to a Wave-1 acceptance
   * blocker — ADR-022 §5's `entry_refs` covers entry-to-entry references only,
   * with no term-target schema yet (content-lib sign-off on a typed `term_refs`
   * index, or an accepted `entry_refs` extension for term targets, is owed).
   * Always resolves `null` until that schema lands.
   */
  function resolveTermRefTarget(_target: TermRefTarget, _ctx: RouteResolveContext): RouteUrl | null {
    return null;
  }

  const UNSAFE_URL_SCHEMES = ["javascript:", "data:"] as const;

  /**
   * @complexity O(1) (bounded scheme-prefix check).
   */
  function resolveUrlTarget(target: UrlTarget, ctx: RouteResolveContext): RouteUrl | null {
    const href = target.href.trim();
    const lowered = href.toLowerCase();
    if (UNSAFE_URL_SCHEMES.some((scheme) => lowered.startsWith(scheme))) {
      return null;
    }
    return { path: href, canonicalUrl: composeCanonicalUrl(href, ctx) };
  }

  function resolveRouteRefTarget(target: RouteRefTarget, ctx: RouteResolveContext): RouteUrl | null {
    const path = getNamedRoute({ name: target.route });
    if (path === null) return null;
    return { path, canonicalUrl: composeCanonicalUrl(path, ctx) };
  }

  /**
   * Resolve a `RouteTarget` to its concrete path + canonical URL.
   *
   * Purpose: the one inverse-resolution entrypoint Menus and SEO depend on.
   * Deviates from ADR-039 §2's 2-arg pseudocode (`urlFor(target, ctx)`) by
   * taking a required-object first parameter carrying `deps` — `entryRef`
   * resolution needs an async `PostRepoPort` call, so `urlFor` must be async and
   * (per this repo's house style) DI'd rather than reaching for a singleton.
   * The semantic contract (target + workspace-scoped ctx → `RouteUrl | null`) is
   * unchanged.
   *
   * @returns `null` when the target is unavailable (not found, unpublished,
   * unresolvable taxonomy term, unsafe URL scheme, or unregistered route name) —
   * never throws for those cases, so callers can treat "no link" uniformly.
   * @throws {RouteResolutionError} only if `target.kind` is not one of the four
   * known discriminants (defensive; unreachable through the typed union).
   * @complexity O(1) plus the cost of one repo call for `entryRef` targets.
   */
  async function urlFor(
    required: UrlForRequired,
    _optional: UrlForOptional = {}
  ): Promise<RouteUrl | null> {
    const { deps, target, ctx } = required;
    switch (target.kind) {
      case "entryRef":
        return resolveEntryRefTarget(deps, target, ctx);
      case "termRef":
        return resolveTermRefTarget(target, ctx);
      case "url":
        return resolveUrlTarget(target, ctx);
      case "route":
        return resolveRouteRefTarget(target, ctx);
      default: {
        const unreachable: never = target;
        throw new RouteResolutionError(
          `unrecognized route target kind: ${JSON.stringify(unreachable)}`
        );
      }
    }
  }

  /**
   * Whether `target` resolves to `currentPath` — the active-state Menus needs
   * for nav highlighting.
   *
   * v0 does exact-path matching only, after normalization. Ancestor/prefix
   * semantics for nested menu highlighting (is `/blog` active on `/blog/post`?)
   * are explicitly deferred to v0.1 (ADR-039 "Open" item 3) since they also
   * need the `urlFor → null` caller-render contract (hide vs. render inert)
   * pinned first.
   *
   * @returns `false` when the target is unavailable (delegates to `urlFor`).
   * @complexity Same as `urlFor` plus O(n) path normalization.
   */
  async function isActive(
    required: IsActiveRequired,
    _optional: IsActiveOptional = {}
  ): Promise<boolean> {
    const resolved = await urlFor({ deps: required.deps, target: required.target, ctx: required.ctx });
    if (!resolved) return false;
    return normalizePath(resolved.path) === normalizePath(required.currentPath);
  }

  const phaseRegistry: PhaseRegistry = {
    pre_content: [],
    post_content: [],
  };

  /** Every phase, so an owner-wide revoke never has to be told which phases it used. */
  const ALL_PHASES: readonly RouteResolvePhaseName[] = ["pre_content", "post_content"];

  /**
   * Register a resolver into an ordered, core-owned pipeline phase
   * (`normalize → pre_content → content-resolve → post_content → 404`,
   * ADR-039 §1). Not an open ADR-009 plugin hook in v1 — this is the seam
   * Redirects (ADR-033) will register into once it exists; no real rules are
   * registered by this library itself.
   *
   * Resolvers within a phase run in registration order; the first non-`null`
   * outcome short-circuits the remaining resolvers in that phase and the rest
   * of the pipeline. Per ADR-039 Round-2 amendment 5, a `pre_content` resolver
   * must only ever return a redirect/gone decision with an audited rule — it
   * must never fabricate a `not_found` for a path that live content could still
   * resolve. This library does not enforce that invariant (no rules exist yet
   * to violate it); it is a contract note for the future Redirects implementer.
   *
   * Lifecycle (2026-09-16). This registry is module-level and therefore
   * process-wide, but its registrants are not: a composition root registers a
   * handler that has CLOSED OVER that composition's resources, and more than one
   * composition runs per process (an integration test boots one site per case,
   * and `createRouteDeps()` plus `createSiteRouteDeps()` can both run in one
   * test process). Append-only, that left every previous composition's closure
   * live on the request path forever — benign
   * while the superseded resources were in-memory, a `TypeError: The database
   * connection is not open` 500 on every phase-running route once one of them
   * was a site database that had since closed. Pass {@link
   * RegisterResolvePhaseOptions.owner} to opt into supersede-on-re-registration;
   * {@link unregisterResolvePhaseOwner} revokes an owner outright.
   *
   * @returns a disposer that removes exactly this registration (idempotent, and
   * a no-op once an owner-scoped re-registration has already superseded it).
   * @complexity O(1) for an unowned registration; O(n) in the phase's existing
   * registrations for an owned one (it first evicts that owner's). O(1) space.
   */
  function registerResolvePhase(
    { phase, resolver }: { phase: RouteResolvePhaseName; resolver: RouteResolvePhaseHandler },
    options: RegisterResolvePhaseOptions = {}
  ): () => void {
    const owner = options.owner;
    if (owner !== undefined) {
      phaseRegistry[phase] = phaseRegistry[phase].filter((entry) => entry.owner !== owner);
    }
    const registration: PhaseRegistration = { owner, handler: resolver, onError: options.onError ?? "fail" };
    phaseRegistry[phase].push(registration);
    return () => {
      phaseRegistry[phase] = phaseRegistry[phase].filter((entry) => entry !== registration);
    };
  }

  /**
   * Revoke every handler `owner` registered, across every phase — the explicit
   * teardown half of {@link RegisterResolvePhaseOptions.owner}, for a host that
   * knows when a site is finished rather than only when the next one starts.
   *
   * Unowned registrations are never matched: `undefined` is the "no owner" marker,
   * not an owner, so `unregisterResolvePhaseOwner(undefined)` is a deliberate no-op.
   *
   * @complexity O(n) in total registered handlers. O(1) space.
   */
  function unregisterResolvePhaseOwner({ owner }: { owner: unknown }, _optional: EmptyOptions = {}): void {
    if (owner === undefined) return;
    for (const phase of ALL_PHASES) {
      phaseRegistry[phase] = phaseRegistry[phase].filter((entry) => entry.owner !== owner);
    }
  }

  /**
   * Run one phase's handlers in registration order, first non-`null` outcome wins.
   *
   * A handler's fault policy is its own registration's {@link RegisterResolvePhaseOptions.onError}
   * (2026-09-16, t91 F4.3 — previously every throw was unconditionally isolated). `"skip"` logs the
   * failure and continues with the next handler, rather than propagating out of the phase — correct
   * for a handler whose failure can only DECLINE an outcome (a redirect, a gone), never fabricate
   * one, which is why Redirects opts into it (`redirects/phase-handler.ts`'s INV-03). `"fail"` (the
   * default) rethrows instead: a handler that guards content (a takedown, a reserved path) must not
   * silently wave a request through just because its own check broke. No log on the `"fail"` path —
   * the caller's own catch reports it (`routes/site/pages.ts`'s `reportSiteRenderFault`), so a fault
   * produces exactly one log line either way.
   *
   * The old universal-skip default is why a stale closed-database handler could take down `/` and
   * `/pricing` while `/products` (which runs no phase) kept serving — that direction (never let one
   * registrant 500 every route) is still correct for `"skip"`; it is just no longer assumed for
   * every registrant.
   *
   * @complexity O(h) in the phase's registered handlers, plus each handler's own
   * opaque cost; short-circuits on the first outcome or the first `"fail"`-policy throw.
   */
  async function runPhase(
    phase: RouteResolvePhaseName,
    path: string,
    ctx: RouteResolveContext
  ): Promise<RouteResolvePhaseOutcome | null> {
    // Snapshot: a handler is free to register or revoke during its own run, and
    // mutating the live array mid-iteration would silently skip a sibling.
    for (const { handler, onError } of [...phaseRegistry[phase]]) {
      let outcome: RouteResolvePhaseOutcome | null;
      try {
        outcome = await handler(path, ctx);
      } catch (err) {
        if (onError !== "skip") throw err;
        // The host retains its operator-facing route fault channel.
        required.ports.reportPhaseError({ message: `[routing] a ${phase} resolver failed for ${path} — skipping it`, error: err });
        continue;
      }
      if (outcome) return outcome;
    }
    return null;
  }

  /**
   * Run the forward resolution pipeline for an inbound request path.
   *
   * v0 behavior: normalize the path, run `pre_content` resolvers, then (with no
   * `content-resolve` step wired here — that is fixed core content lookup, out
   * of scope for this library) run `post_content` resolvers. Falls through to
   * `{ matched: false }` (404) if nothing resolves. This is a registration seam
   * for Redirects, not full pipeline behavior — no real rules exist yet.
   *
   * @complexity O(h) where h is the total number of registered phase handlers
   * that run before a match (or all of them, on a full miss); each handler's own
   * cost is opaque to this function.
   */
  async function resolve(
    required: ResolveRequired,
    _optional: ResolveOptional = {}
  ): Promise<RouteResolveResult> {
    const path = normalizePath(required.input.path);
    const ctx = required.input.ctx;

    const preOutcome = await runPhase("pre_content", path, ctx);
    if (preOutcome) return { matched: true, phase: "pre_content", outcome: preOutcome };

    // content-resolve: fixed core content lookup, not a registered phase of this
    // library in v0 — intentionally a no-op here (see file header).

    const postOutcome = await runPhase("post_content", path, ctx);
    if (postOutcome) return { matched: true, phase: "post_content", outcome: postOutcome };

    return { matched: false };
  }

  /**
   * Run only the `pre_content` phase for `path` (ADR-PIPE-009 Decision B / C-012).
   *
   * The Decision B seam: `resolve()`'s v0 shape bundles `pre_content` and
   * `post_content` back-to-back with no pause for a caller's own content
   * lookup in between. This additive, thin wrapper around the already-tested
   * module-private `runPhase()` lets a real site route run ONLY `pre_content`
   * before its own content lookup, and (separately) `runPostContentPhase` only
   * after that lookup has failed — exactly ADR-039 §1's documented pipeline
   * order (`pre_content -> content-resolve -> post_content`), which the single
   * `resolve()` export cannot reproduce when a real content lookup must run in
   * the middle. `resolve()`'s own SHAPE is UNCHANGED by this addition — this
   * paragraph is about these wrapper functions existing alongside it, not about
   * `resolve()`'s own throw behavior. Separately (2026-09-16, t91 F4.3):
   * `resolve()` now CAN reject when a `"fail"`-policy handler throws, exactly
   * like these wrappers — both go through the same `runPhase()`, which gained
   * that throw path in the same change. `resolve()` has no production caller
   * today (grep; only tests call it), so this is a latent property, not a
   * behavior change any caller currently observes.
   *
   * @complexity O(h) in registered `pre_content` handlers.
   */
  async function runPreContentPhase(
    { path, ctx }: { path: string; ctx: RouteResolveContext },
    _optional: EmptyOptions = {}
  ): Promise<RouteResolvePhaseOutcome | null> {
    return runPhase("pre_content", normalizePath(path), ctx);
  }

  /**
   * Run only the `post_content` phase for `path` (ADR-PIPE-009 Decision B / C-013).
   * See {@link runPreContentPhase}'s doc for the full rationale.
   *
   * @complexity O(h) in registered `post_content` handlers.
   */
  async function runPostContentPhase(
    { path, ctx }: { path: string; ctx: RouteResolveContext },
    _optional: EmptyOptions = {}
  ): Promise<RouteResolvePhaseOutcome | null> {
    return runPhase("post_content", normalizePath(path), ctx);
  }

  // ---------------------------------------------------------------------------
  // SlugChangeCapture slot (ADR-039 §4)
  // ---------------------------------------------------------------------------

  let boundSlugChangeCapture: SlugChangeCapture | undefined;

  /**
   * Bind the single `SlugChangeCapture` implementation the content write
   * chokepoint calls inside a rename transaction. Per ADR-039 Round-2
   * amendment 1, no slot implementation may be plugin-supplied — this function
   * has no plugin-facing registration path today, only a core composition-root
   * call site.
   *
   * Fail-closed nuance (Round-2 amendment 3), NOT enforced here: an absent
   * binding is only a safe no-op before Redirects is installed, or while
   * slug-preservation is disabled for the workspace. Once link-preservation is
   * enabled, a slug-changing rename with no bound capture MUST fail
   * `LINK_PRESERVATION_UNAVAILABLE` rather than silently skip the redirect —
   * that check belongs to the content write chokepoint (which knows whether
   * preservation is enabled) and to Redirects (neither exists in this repo
   * yet). This library only exposes the registration slot itself.
   *
   * @returns a disposer that unbinds exactly THIS registration: a no-op once a later call has bound
   * another implementation, so a stale composition torn down after a newer one booted cannot clear
   * the newer site's capture (the same identity scoping `registerResolvePhase`'s disposers use).
   */
  function registerSlugChangeCapture({ impl }: { impl: SlugChangeCapture }, _optional: EmptyOptions = {}): () => void {
    boundSlugChangeCapture = impl;
    return () => {
      if (boundSlugChangeCapture === impl) boundSlugChangeCapture = undefined;
    };
  }

  /** The currently bound `SlugChangeCapture`, or `undefined` if none is bound. */
  function getSlugChangeCapture(_required: EmptyOptions, _optional: EmptyOptions = {}): SlugChangeCapture | undefined {
    return boundSlugChangeCapture;
  }

  // ---------------------------------------------------------------------------
  // Test-only registry resets (deep-imported directly by this library's own
  // tests; deliberately NOT exported from index.ts's public barrel)
  // ---------------------------------------------------------------------------

  /** Restore all module-level registries to their v0 defaults. Test use only. */
  function resetRoutingRegistrationsForTests(_required: EmptyOptions, _optional: EmptyOptions = {}): void {
    namedRoutes.clear();
    for (const [name, path] of initialNamedRoutes) namedRoutes.set(name, path);
    phaseRegistry.pre_content = [];
    phaseRegistry.post_content = [];
    boundSlugChangeCapture = undefined;
  }
  return { entryPublicPath, getNamedRoute, getSlugChangeCapture, isActive, postPublicPath, registerNamedRoute, registerResolvePhase, registerSlugChangeCapture, resolve, runPostContentPhase, runPreContentPhase, unregisterResolvePhaseOwner, urlFor, resetRoutingRegistrationsForTests };
}
