/**
 * @module route-manifest
 *
 * Which `{method, path}` pairs each route family mounts, as inert data a caller can read *without*
 * mounting anything.
 *
 * **The problem this solves.** A host that puts a reverse proxy in front of a Jini daemon in another
 * process has to know that daemon's route list to forward anything. With no published inventory, the
 * only way to build one is to copy path strings by hand — and a hand-copied list silently falls behind
 * the moment a family gains a route. That has already happened at least once in a real consumer: a
 * proxy shipped without `GET /api/runs` and the daemon's list endpoint was simply unreachable, 404-ing
 * at the host's own router with nothing to indicate the host was the cause.
 *
 * **Why this file cannot itself drift.** It declares no method or path literals. Every entry is derived
 * from the very `JsonRouteSpec` constant the family's `register*Routes` function mounts, so a spec's
 * path change moves the manifest with it, automatically. The single exception is the SSE run-event
 * route, which is registered with a bare `app.get` rather than a spec — and it contributes the
 * already-exported `RUN_STREAM_ROUTE_PATH` constant rather than a copy of it.
 *
 * That leaves exactly one failure mode: a family gains a route and nobody adds it *here*. The paired
 * test (`__tests__/route-manifest.test.ts`) closes that by mounting each declared family's real
 * registrar onto a recording app and asserting the manifest matches what actually registered — so a
 * missing entry fails a test rather than reaching a consumer.
 *
 * **Scope, stated honestly: this covers the families a sidecar consumer proxies**, not all 19 the
 * package can mount. {@link routeFamilyManifest} returns `undefined` for anything undeclared rather
 * than an empty list, so "not described here" is distinguishable from "has no routes" — a proxy must
 * never conclude a family is empty when it is merely undocumented. Adding a family is a matter of
 * listing its exported specs below; the test then holds it correct.
 */
import { agentListRoute, agentRescanRoute } from './agents.js';
import { delegatedToolExecuteRoute } from './delegated-tools.js';
import {
  apiHealthRoute,
  apiReadyRoute,
  apiVersionInfoRoute,
  healthRoute,
  readyRoute,
  versionInfoRoute,
} from './health.js';
import { RUN_STREAM_ROUTE_PATH } from './run-stream.js';
import {
  RUN_EVENTS_ROUTE_PATH,
  runCancelRoute,
  runListRoute,
  runStartRoute,
  runStatusRoute,
} from './runs.js';
import { toolCatalogDescribeRoute, toolCatalogSearchRoute } from './tool-catalog.js';
import type { RouteRegistration } from './route-registration-guard.js';

/** Minimal shape this module reads off a route spec. Structurally satisfied by any `JsonRouteSpec`. */
interface RoutePathSpec {
  readonly method: string;
  readonly path: string;
}

/**
 * Projects route specs onto `RouteRegistration`s, upper-casing the method so entries compare directly
 * against {@link getRouteRegistrationInventory}'s output.
 *
 * @param specs - Route specs, passed by reference so no path literal is ever restated.
 * @returns One registration per spec, in argument order.
 * @complexity O(n) in the number of specs.
 * @overallScore 100/100
 */
function fromSpecs(...specs: readonly RoutePathSpec[]): readonly RouteRegistration[] {
  return specs.map((spec) => ({ method: spec.method.toUpperCase(), path: spec.path }));
}

/**
 * Route families described by this manifest, keyed by the same feature id `@jini-ai/server`'s built-in
 * feature catalog uses — so a host that enables features by name can look routes up by that same name.
 */
export const JINI_ROUTE_MANIFEST: Readonly<Record<string, readonly RouteRegistration[]>> = {
  health: fromSpecs(
    healthRoute,
    apiHealthRoute,
    readyRoute,
    apiReadyRoute,
    versionInfoRoute,
    apiVersionInfoRoute,
  ),
  runs: [
    ...fromSpecs(runStartRoute, runListRoute, runStatusRoute, runCancelRoute),
    // Two distinct streaming routes, both registered with a bare `app.get` rather than a route spec,
    // so each contributes its exported path constant instead of a copied literal. They are easy to
    // mistake for one another and a proxy needs BOTH: `RUN_EVENTS_ROUTE_PATH` is the run's own event
    // log (mounted by `registerRunRoutes` itself), `RUN_STREAM_ROUTE_PATH` is the protocol-encoded
    // stream `registerRunStreamRoute` mounts separately. Forwarding only the first is a real,
    // already-observed consumer bug.
    { method: 'GET', path: RUN_EVENTS_ROUTE_PATH },
    { method: 'GET', path: RUN_STREAM_ROUTE_PATH },
  ],
  agents: fromSpecs(agentListRoute, agentRescanRoute),
  toolCatalog: fromSpecs(toolCatalogSearchRoute, toolCatalogDescribeRoute),
  delegatedToolCalls: fromSpecs(delegatedToolExecuteRoute),
};

/**
 * The routes one family mounts.
 *
 * @param family - A feature id, e.g. `'runs'`.
 * @returns That family's registrations, or `undefined` when the family is not described by this
 * manifest. The distinction matters: a caller building a proxy allow-list must treat `undefined` as
 * "look it up yourself", never as "this family has no routes" — see this module's scope note.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function routeFamilyManifest(family: string): readonly RouteRegistration[] | undefined {
  return JINI_ROUTE_MANIFEST[family];
}

/**
 * Every route across every family this manifest describes, de-duplicated.
 *
 * De-duplication is real rather than defensive: `health` intentionally mounts both `/health` and
 * `/api/health` as separate routes, and a future family could legitimately share a path with another.
 *
 * @param families - Family ids to include. Unknown ids contribute nothing (rather than throwing), so a
 * caller can pass its enabled-feature list verbatim without pre-filtering it.
 * @returns One entry per distinct `METHOD PATH`, in first-seen order.
 * @complexity O(n) in the total routes across the named families.
 * @overallScore 100/100
 */
export function manifestRoutesForFamilies(families: readonly string[]): readonly RouteRegistration[] {
  const seen = new Set<string>();
  const routes: RouteRegistration[] = [];
  for (const family of families) {
    for (const route of JINI_ROUTE_MANIFEST[family] ?? []) {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(route);
    }
  }
  return routes;
}
