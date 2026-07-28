/**
 * @module health
 *
 * `GET /health`, `GET /api/health` (plain liveness — always `200 {ok: true, version}` once the
 * process is up, no dependency checks), `GET /ready`, `GET /api/ready` (real readiness —
 * delegates to an injected `checkReadiness`, `503` when it reports `ok: false`), and `GET
 * /version`, `GET /api/version` (echoes the running build's version). Both the mount-relative
 * and `/api`-prefixed form of each probe are registered because `api-security-middleware.ts`'s
 * `OPEN_PROBE_PATHS` already anticipated exactly these six paths as always-open (no bearer token,
 * no origin check) — this module is what finally makes that anticipated set of paths real routes
 * instead of an open gate over nothing.
 *
 * **Mount before `express.json()`/the bearer-auth/origin-guard middleware** (see
 * `@jini-ai/node-host`'s `create-local-node-daemon.ts` wiring): these are simple parameterless GETs
 * with no request body, so nothing here needs JSON body-parsing, and a monitoring probe should
 * never need a bearer token or same-origin `Origin` header just to confirm the process is up —
 * the same reasoning `api-security-middleware.ts`'s own doc already gives for exempting these
 * paths.
 *
 * **`daemon-status.ts#daemonStatusRoute`'s own doc previously called `GET /api/daemon/status` "a
 * health-check" — this module is the real, purpose-built answer to that now.** `/api/daemon/status`
 * still exists and still reports version/host/port/data-dir/shutdown state (useful operator
 * detail), but a liveness/readiness monitor should poll `/health`/`/ready` instead: those are
 * unauthenticated by design (see above), `/api/daemon/status` is not gated same-origin either
 * today, but was never *documented* as the liveness contract — see that module's updated doc
 * comment.
 *
 * **OD-parity, verified live 2026-07-22** by booting a real Open Design daemon (`apps/daemon/bin/
 * od.mjs --no-open`, from a full clone of `nexu-io/open-design`) and curling its real
 * `/api/health`, `/api/ready`, `/api/version` handlers (`apps/daemon/src/server.ts:2624-2642`).
 * Live responses observed: `GET /api/health` → `200 {"ok":true,"version":"0.15.1"}`; `GET
 * /api/ready` → `200 {"ok":true,"ready":true,"version":"0.15.1"}` (the handler's readiness check
 * is a single `!daemonShuttingDown` boolean, not a pluggable checks map — `server.ts:2629-2637`);
 * `GET /api/version` → `200 {"version":{"version":"0.15.1","channel":"development",
 * "packaged":false,"platform":"darwin","arch":"x64"}}` (the full `AppVersionInfo` shape from
 * `app-version.ts:12-18`, nested under the `version` key — not a bare string). Confirmed OD
 * registers no bare (non-`/api`-prefixed) `/health`/`/ready`/`/version` routes at all (`GET
 * /health` 404s live) — this module's mount-relative variants are a deliberate Jini generalization
 * for hosts that don't prefix their API under `/api`, not an OD-observed route. Also confirmed no
 * origin/CORS headers appear on any of the three live OD responses — `requireLocalDaemonRequest`
 * (`http/local-daemon-request.ts`), which is what stamps `Vary: Origin`/`Access-Control-*`
 * headers on other `/api/daemon/*` routes like shutdown, is never applied to health/ready/version,
 * matching this module's `requireSameOrigin`-unset routes.
 *
 * Two real gaps that live comparison caught and this module now fixes: `livenessRoute` and
 * `readinessRoute` used to omit `version` entirely, and `readinessRoute`'s success body had no
 * `ready` field — both now present, sourced from the same `deps.getVersion()` already wired for
 * `/version`. One gap intentionally left open: `/version`'s response here stays a flat `{version:
 * string}` (via the same string-returning `getVersion` convention `daemon-status.ts` already
 * uses) rather than OD's nested `AppVersionInfo` object — the channel/packaged/platform/arch
 * fields aren't wired anywhere in Jini today (`@jini-ai/node-host`'s `create-local-node-daemon.ts`
 * only ever supplies a plain version string), and inventing that plumbing is a host-level decision
 * out of this file's scope, not something to paper over with an unused type change here.
 */
import type { Express } from 'express';
import { createApiError } from '@jini-ai/protocol';
import { defineJsonRoute, mountJsonRoute, type AdapterContext } from './adapter.js';
import { err, ok } from './types.js';

export interface HealthReadinessResult {
  readonly ok: boolean;
  readonly checks: Record<string, boolean>;
}

export interface HealthHttpDeps {
  /** Resolves the running build's version string. May be sync or async, matching `daemon-status.ts#DaemonStatusDeps.getVersion`. */
  readonly getVersion: () => Promise<string> | string;
  /** Host-owned readiness probe (e.g. "is the sqlite handle healthy and is the process not mid-shutdown"). Defaults to always-ready (`{ok: true, checks: {}}`) — a host with nothing worth checking gets a working route with no wiring required. */
  readonly checkReadiness?: () => Promise<HealthReadinessResult>;
}

async function defaultCheckReadiness(): Promise<HealthReadinessResult> {
  return { ok: true, checks: {} };
}

export interface LivenessResponse {
  readonly ok: true;
  /** The running build's version string. Matches OD's real `/api/health` — see module doc. */
  readonly version: string;
}

export interface ReadinessResponse {
  readonly ok: true;
  /** Mirrors `ok` — OD's real `/api/ready` carries both fields; see module doc. */
  readonly ready: true;
  /** The running build's version string. Matches OD's real `/api/ready` — see module doc. */
  readonly version: string;
  readonly checks: Record<string, boolean>;
}

export interface VersionResponse {
  readonly version: string;
}

function livenessRoute(path: string) {
  return defineJsonRoute<void, LivenessResponse, HealthHttpDeps>({
    method: 'get',
    path,
    parse: () => ok(undefined),
    handle: async (_input, deps) => ok({ ok: true, version: await deps.getVersion() }),
  });
}

function readinessRoute(path: string) {
  return defineJsonRoute<void, ReadinessResponse, HealthHttpDeps>({
    method: 'get',
    path,
    parse: () => ok(undefined),
    handle: async (_input, deps) => {
      const checkReadiness = deps.checkReadiness ?? defaultCheckReadiness;
      const [result, version] = await Promise.all([checkReadiness(), deps.getVersion()]);
      if (!result.ok) {
        return err(createApiError('SERVICE_UNAVAILABLE', 'service not ready', { details: { checks: result.checks } }));
      }
      return ok({ ok: true, ready: true, version, checks: result.checks });
    },
  });
}

function versionRoute(path: string) {
  return defineJsonRoute<void, VersionResponse, HealthHttpDeps>({
    method: 'get',
    path,
    parse: () => ok(undefined),
    handle: async (_input, deps) => ok({ version: await deps.getVersion() }),
  });
}

export const healthRoute = livenessRoute('/health');
export const apiHealthRoute = livenessRoute('/api/health');
export const readyRoute = readinessRoute('/ready');
export const apiReadyRoute = readinessRoute('/api/ready');
export const versionInfoRoute = versionRoute('/version');
export const apiVersionInfoRoute = versionRoute('/api/version');

/** Mounts all six health/readiness/version routes on `app`. Call this before installing `express.json()`/the bearer-auth/origin-guard middleware — see module doc. */
export function registerHealthRoutes(app: Express, deps: HealthHttpDeps, adapter: AdapterContext): void {
  mountJsonRoute(app, healthRoute, deps, adapter);
  mountJsonRoute(app, apiHealthRoute, deps, adapter);
  mountJsonRoute(app, readyRoute, deps, adapter);
  mountJsonRoute(app, apiReadyRoute, deps, adapter);
  mountJsonRoute(app, versionInfoRoute, deps, adapter);
  mountJsonRoute(app, apiVersionInfoRoute, deps, adapter);
}
