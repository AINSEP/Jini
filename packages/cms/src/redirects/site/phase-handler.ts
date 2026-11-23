/**
 * Host routing-registry binding. Resolution and the interpolated Location gate live in
 * `packages/cms/src/redirects/{resolver,target-gate}.ts` (INV-03).
 */
import { createRedirectResolver, type RedirectPhaseHandlerDeps } from "../resolver.js";
import type { RedirectResolver } from "../ports.js";
import type { RedirectResolution } from "../types.js";
import type { RouteResolveContext, RouteResolvePhaseOutcome, Routing } from "../../routing/index.js";

/**
 * The host's bound `registerResolvePhase` — from the ONE `createRouting` instance its composition
 * roots share, so a registration here is visible to that instance's phase runners.
 */
export type RegisterRedirectsResolvePhase = Routing["registerResolvePhase"];

/** Product ports, or an injected resolver for registry lifecycle characterization; both carry the host's routing registration. */
export type RegisterRedirectsPhaseHandlersDeps =
  | (Omit<RedirectPhaseHandlerDeps, "hits"> & { registerResolvePhase: RegisterRedirectsResolvePhase })
  | { resolver: RedirectResolver; registerResolvePhase: RegisterRedirectsResolvePhase };

/**
 * The identity every Redirects registration claims in `routing`'s phase registry
 * (`RegisterResolvePhaseOptions.owner`). One module-private token, shared by every
 * call: there is exactly ONE live Redirects registration per process — whichever
 * composition root registered most recently.
 *
 * That is the policy half of the lifecycle fix `registerResolvePhase`'s own doc
 * describes. `registerRedirectsPhaseHandlers` runs once per composition root, and a
 * process can run more than one of those — an integration test composes one per
 * site it boots. Loading `composition/app.ts` itself registers nothing (removed
 * 2026-09-16, t91 F4.1; `app-module-load-registers-no-phase-handler.test.ts` pins
 * it), so the only way a process gets a second composition is an explicit
 * `createRouteDeps()`/`createSiteRouteDeps()` call. Each registration closes over
 * that composition's own `RedirectRepoPort`, so under the old append-only registry
 * the superseded ones stayed on the live request path: harmless while the orphan was
 * an `InMemoryRedirectRepo` (empty, so it returned `null` and yielded to the real
 * registration queued behind it), a 500 on every phase-running route once it was a
 * `SqliteRedirectRepo` whose site database had since closed. Owning the slot makes
 * W-004's "call exactly once" structural rather than a comment asking nicely.
 */
const REDIRECTS_PHASE_OWNER: unique symbol = Symbol("redirects.phase-handlers");

/**
 * Composition-root wiring entry — registers the two `RouteResolvePhaseHandler`
 * adapters into `routing`'s registry, superseding any previous composition's
 * (see {@link REDIRECTS_PHASE_OWNER}).
 *
 * @returns a disposer that removes exactly THIS registration (both phases) — not
 * "whatever Redirects registration happens to be live". It composes `registerResolvePhase`'s
 * own per-call disposers, each of which is a no-op once an owner-scoped re-registration has
 * already superseded it. That identity-scoping is load-bearing: a stale composition's disposer
 * called AFTER a newer one has registered (site A torn down after site B booted) must decline
 * to remove B's redirects, not revoke them via the shared owner symbol (t91 F4.2 Part A,
 * 2026-09-16 — see `phase-handler.disposer-scope.test.ts`).
 * @complexity O(1) amortized; O(n) in each phase's existing registrations for the
 * supersede scan.
 * @example const dispose = registerRedirectsPhaseHandlers({ repo, matcher, originRegistry, reservedSegments, registerResolvePhase: routing.registerResolvePhase }, { hits });
 */
export function registerRedirectsPhaseHandlers(
  required: RegisterRedirectsPhaseHandlersDeps,
  optional: Pick<RedirectPhaseHandlerDeps, "hits"> = {},
): () => void {
  const { registerResolvePhase } = required;
  const resolver = "resolver" in required
    ? required.resolver
    : createRedirectResolver(withoutRegistration(required), optional);

  const preContentHandler = async (
    path: string,
    ctx: RouteResolveContext
  ): Promise<RouteResolvePhaseOutcome | null> => {
    const resolution = await resolver.resolve({ workspaceId: ctx.workspaceId, path, phase: "pre_content" });
    return toOutcome(resolution);
  };

  const postContentHandler = async (
    path: string,
    ctx: RouteResolveContext
  ): Promise<RouteResolvePhaseOutcome | null> => {
    const resolution = await resolver.resolve({ workspaceId: ctx.workspaceId, path, phase: "post_content" });
    return toOutcome(resolution);
  };

  // onError: "skip" (t91 F4.3 — routing.ts's default changed to "fail"): a redirect lookup
  // failure can only DECLINE to redirect (INV-03, toOutcome above never fabricates one), so one
  // broken rule store must not 500 every page on the site the way a guard-type handler should.
  const disposePreContent = registerResolvePhase({ phase: "pre_content", resolver: preContentHandler }, {
    owner: REDIRECTS_PHASE_OWNER,
    onError: "skip",
  });
  const disposePostContent = registerResolvePhase({ phase: "post_content", resolver: postContentHandler }, {
    owner: REDIRECTS_PHASE_OWNER,
    onError: "skip",
  });
  return () => {
    disposePreContent();
    disposePostContent();
  };
}

/** The resolver's own ports only — the routing registration is this module's, not the resolver's. */
function withoutRegistration(
  required: Omit<RedirectPhaseHandlerDeps, "hits"> & { registerResolvePhase: RegisterRedirectsResolvePhase },
): Omit<RedirectPhaseHandlerDeps, "hits"> {
  const { registerResolvePhase: _registration, ...ports } = required;
  return ports;
}

function toOutcome(resolution: RedirectResolution): RouteResolvePhaseOutcome | null {
  if (!resolution.matched) return null;
  return { kind: "redirect", location: resolution.location, statusCode: resolution.statusCode };
}
