import type { JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

/**
 * @file Shared guards and error mapping for the `plugins` admin route specs.
 *
 * The plugin mechanism (discovery, activation, uninstall, package files, hooks) lives in
 * `@jini-ai/plugins`, which `@jini-ai/cms` does not depend on. So the specs never import it: the
 * host injects each pre-bound mechanism as a function, and the error classes each route's `catch`
 * ladder maps, as constructors. The status/code table stays here, next to the route, in the same
 * order the hand-written ladder had.
 */

/** The principal fields these routes read: only the id, as the uninstall actor. */
export interface PluginsRoutePrincipal { id: string }

/** The discovery-record fields the specs read; the host's full record passes through untouched. */
export interface PluginRouteRecord { readonly id: string; readonly source: string }

/** An injected error class a route maps (`instanceof` is checked against it). */
export type PluginErrorClass<E extends Error = Error> = abstract new (...args: never[]) => E;

/** One `catch` rung: the error class, its status and code, and fixed text when the message is unsafe. */
export interface PluginErrorRung {
  readonly is: PluginErrorClass;
  readonly status: number;
  readonly code: string;
  /** Replaces the error's own message (e.g. one that names absolute server paths). */
  readonly error?: string;
}

/**
 * Refuses with the first matching rung (flat `{ error, code }`); anything unmapped — including a
 * refusal the handler already threw — is rethrown unchanged for the host's error port.
 * @complexity O(n) in the rung count, a small fixed list per route.
 */
export function rejectPluginError({ err, rungs }: { err: unknown; rungs: readonly PluginErrorRung[] }, _optional: Record<string, never> = {}): never {
  const rung = rungs.find((candidate) => err instanceof candidate.is);
  if (!rung) throw err;
  rejectRoute({ status: rung.status, error: rung.error ?? (err as Error).message, code: rung.code });
}

/**
 * Asks the host for one permission. The hand-written plugin routes named no entity id (not even the
 * by-id ones), so no scope is sent. A mount without an authorizer is a wiring bug: fail closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizePlugins({ authorize, permission }: { authorize: JsonRouteAuthorize | undefined; permission: string }, _optional: Record<string, never> = {}): Promise<void> {
  if (!authorize) throw new Error("plugins admin route has no authorizer");
  await authorize({ permission, entityType: "plugin" });
}

/** The authenticated principal's id (the uninstall actor). @complexity O(1). */
export function pluginActorId({ context }: { context: PluginsRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("plugins admin route has no authenticated principal");
  return context.id;
}

/** The `:pluginId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function pluginIdParam({ params }: { params: Record<string, string | undefined> }, _optional: Record<string, never> = {}): string {
  return String(params.pluginId ?? "");
}

/** Finds the discovered record for `pluginId` or refuses with the shared 404. @complexity O(n) in discovered plugins. */
export function requireDiscovered<R extends PluginRouteRecord>({ records, pluginId }: { records: readonly R[]; pluginId: string }, _optional: Record<string, never> = {}): R {
  const record = records.find((candidate) => candidate.id === pluginId);
  if (!record) rejectRoute({ status: 404, error: "plugin was not found", code: "PLUGIN_NOT_FOUND" });
  return record;
}
