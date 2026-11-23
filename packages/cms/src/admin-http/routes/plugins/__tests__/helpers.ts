import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import type { PluginActivationRecord } from "@jini-ai/core/contracts/site/plugins-host";

/** @file Shared fakes for the plugins route-spec tests: records, activation rows, a recording authorizer and the refusal reader. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** Stand-ins for the engine's error classes the host injects. */
export class FakeNotFoundError extends Error {}
export class FakeNotUninstallableError extends Error {}
export class FakeEnabledError extends Error {}
export class FakeInTrashError extends Error {}
export class FakeUnsafePathError extends Error {}
export class FakeHookFailedError extends Error {
  constructor(readonly pluginId: string, message: string) { super(message); }
}

export const RECORDS = [{ id: "word-count", source: "site", name: "Word count" }, { id: "seo", source: "built-in", name: "SEO" }] as const;

export function activation(pluginId: string, enabled: boolean): PluginActivationRecord {
  return { workspaceId: WORKSPACE_ID, pluginId, enabled } as unknown as PluginActivationRecord;
}

/** An activation repo over a fixed map; `reads` counts lookups (auth refusals must leave it 0). */
export function activationRepo(rows: Record<string, boolean> = {}) {
  const reads: string[] = [];
  return {
    reads,
    getActivation: async ({ pluginId }: { workspaceId: string; pluginId: string }) => {
      reads.push(pluginId);
      return pluginId in rows ? activation(pluginId, rows[pluginId]!) : null;
    },
  };
}

/** One recorded authorization. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`; `denied` permissions throw, as the host port's 403 refusal would. */
export function recordingAuthorize(denied: readonly string[] = []) {
  const calls: RecordedAuthorize[] = [];
  return {
    calls,
    authorize: async ({ permission, entityType }: { permission: string; entityType: string }, optional: { entityId?: string } = {}) => {
      calls.push({ permission, entityType, ...optional });
      if (denied.includes(permission)) throw new Error(`denied ${permission}`);
    },
  };
}

/** Run `fn` and return the refusal it throws (status + flat body); fails if it does not refuse. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error("expected a route refusal");
}

/** The raw input a host adapter hands `parse`. */
export const raw = (params: Record<string, string>, body: unknown = {}) => ({ body, query: {}, params });
