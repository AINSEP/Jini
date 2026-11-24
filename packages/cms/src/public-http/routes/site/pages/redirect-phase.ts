import type { Routing } from "../../../../routing/routing.js";

/** The redirect write the phase needs from the host's response (an Express `Response` satisfies it). */
export interface RedirectPhaseResponse {
  redirect(statusCode: number, location: string): void;
}

/** The host's routing instance: only its two resolve-phase runners are read. */
export type RedirectPhaseRouting = Pick<Routing, "runPreContentPhase" | "runPostContentPhase">;

/**
 * SPEC-009 (Redirects) REQ-18/19: run the registered `pre_content` phase
 * (redirect rules with `overrideContent: true`) before any content lookup,
 * and `post_content` (the default case) only after a content lookup has
 * failed — the exact `pre_content -> content-resolve -> post_content` order
 * ADR-039 §1 documents. Issues the redirect and returns `true` if a phase
 * matched; the caller falls through to its own content/404 handling on `false`.
 * `routing` is the host's routing instance (its phase registry is module state the host owns).
 */
export async function tryRedirectPhase({ phase, path, workspaceId, res, routing }: { phase: "pre_content" | "post_content"; path: string; workspaceId: string; res: RedirectPhaseResponse; routing: RedirectPhaseRouting }, _optional = {}): Promise<boolean> {
  const outcome =
    phase === "pre_content"
      ? await routing.runPreContentPhase({ path: path, ctx: { workspaceId } })
      : await routing.runPostContentPhase({ path: path, ctx: { workspaceId } });
  // `outcome.kind !== "redirect"` has two type-level arms — `"resolved"` and `"not_found"`
  // (`RouteResolvePhaseOutcome`, @jini-ai/cms/routing) — but only one is reachable through this
  // codebase's real registrants today: `registerResolvePhase` (routing.ts) has exactly one
  // non-test caller repo-wide, `registerRedirectsPhaseHandlers` (redirects/phase-handler.ts),
  // whose own `toOutcome` is the ONLY constructor of this type anywhere in the tree and returns
  // only `null` or `{ kind: "redirect", ... }` — never `"resolved"`/`"not_found"`. Testing that
  // sub-arm would require pushing a resolver onto `registerResolvePhase`'s module-level
  // `phaseRegistry` from a test. That is no longer permanently polluting — as of 2026-09-16 that
  // registry is no longer append-only (`registerResolvePhase` returns a disposer and takes an
  // `owner`, so a test can revoke what it added) — but it still leaves the cost of standing up a
  // second registrant just to reach a sub-arm no shipped code constructs, which is a worse trade
  // than leaving this documented rather than covered. A future SECOND registrant that legitimately returns
  // `"resolved"`/`"not_found"` would make this reachable again; this comment is the disclosure,
  // not a claim that it can never happen.
  if (!outcome || outcome.kind !== "redirect") return false;
  res.redirect(outcome.statusCode, outcome.location);
  return true;
}
