import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { FsCustomRootReadFn, FsCustomRootStatus, FsCustomRootWriteFn } from "../custom-root.js";

/** @file Shared fakes for the fs-files custom-root route-spec tests: an in-memory root store, a recording authorizer and the refusal reader. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;
/** The host's permissions are injected, so the tests use values no real host ships. */
export const READ_PERMISSION = "test.fs.read";
export const MANAGE_PERMISSION = "test.fs.manage";

/** The host's "this path cannot be a root" refusal, as a host would raise it. */
export class FakeInvalidRootError extends Error {}
export const isFakeInvalidRootError = ({ err }: { err: unknown }): boolean => err instanceof FakeInvalidRootError;

/**
 * An in-memory stand-in for the host's per-workspace root store. `vanish` simulates a stored folder
 * that no longer stats as a directory (the store still remembers it, but it is not usable).
 */
export function makeRootStore(initial: Record<string, string> = {}) {
  const stored = new Map(Object.entries(initial));
  const vanished = new Set<string>();
  const writes: Array<{ workspaceId: string; path: string | null }> = [];
  const readCustomRoot: FsCustomRootReadFn = ({ workspaceId }): FsCustomRootStatus => {
    const path = stored.get(workspaceId);
    if (path === undefined) return { path: undefined, vanished: false };
    return vanished.has(workspaceId) ? { path: undefined, vanished: true, vanishedPath: path } : { path, vanished: false };
  };
  const writeCustomRoot: FsCustomRootWriteFn = ({ workspaceId, path }) => {
    writes.push({ workspaceId, path });
    if (path === null) { stored.delete(workspaceId); return; }
    if (!path.startsWith("/")) throw new FakeInvalidRootError(`'${path}' must be an absolute path`);
    stored.set(workspaceId, path);
  };
  return { readCustomRoot, writeCustomRoot, writes, vanish: (workspaceId: string) => vanished.add(workspaceId) };
}

/** One recorded authorization: the permission, the entity type and, for by-id routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`; `denied` permissions throw, as the host port's 403 refusal would. */
export function recordingAuthorize(denied: readonly string[] = []): {
  authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[];
} {
  const calls: RecordedAuthorize[] = [];
  return {
    calls,
    authorize: async ({ permission, entityType }, optional = {}) => {
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
export const raw = (body: unknown = {}, params: Record<string, string> = { workspaceId: WORKSPACE_ID }) => ({ body, query: {}, params });
