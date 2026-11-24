import { defineJsonRoute, ok, type JsonRouteSpec } from "@jini-ai/core/contracts/server";

/**
 * @file The public liveness probes `GET /health` and `GET /healthz`: unauthenticated, root-level
 * (not under any API prefix) and dependency-free. A host mounts them ahead of its body parsers and
 * session middleware, so they answer even while the rest of the app is still booting.
 */

/** `/health` reads no deps: process liveness needs nothing injected. */
export type HealthRouteDeps = Record<string, never>;
/** `/healthz` reads no deps either (see {@link HealthRouteDeps}). */
export type HealthzRouteDeps = Record<string, never>;
/** Neither probe reads the request: params, query and body are all ignored. */
export type LivenessInput = Record<string, never>;
/** The one answer both probes give while the process can serve a request at all. */
export interface LivenessBody { ok: true }

/** One liveness probe at `path`. Shared so the two probes cannot drift apart.
 * @complexity O(1) time/space.
 */
function livenessRoute<Deps>(
  required: { path: string },
  _optional: Record<string, never> = {},
): JsonRouteSpec<LivenessInput, LivenessBody, Deps> {
  return defineJsonRoute<LivenessInput, LivenessBody, Deps>({
    method: "get",
    path: required.path,
    parse: () => ok({ value: {} }),
    // No dependency checks and no authorization: liveness only says the process answers. A
    // dependency failure belongs to the host's readiness probe, never here.
    handle: async () => ok({ value: { ok: true } }),
  });
}

/** `GET /health` — process liveness, `{ ok: true }`. */
export const healthRoute = livenessRoute<HealthRouteDeps>({ path: "/health" });

/**
 * `GET /healthz` — process liveness only, no dependency checks. Mirrors `/health`'s exact behavior
 * (both remain registered; `/health` is not removed).
 */
export const healthzRoute = livenessRoute<HealthzRouteDeps>({ path: "/healthz" });
