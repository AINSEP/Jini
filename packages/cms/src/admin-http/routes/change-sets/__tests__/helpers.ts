import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import type { ChangeSetItemRecord, ChangeSetRecord } from "@jini-ai/core/contracts/events";

/** @file Shared fakes for the change-sets route-spec tests: fixed rows, the host's DTO stand-ins, a recording authorizer. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1", kind: "user" as const };
export const signal = new AbortController().signal;

/** One stored change set. */
export function fakeChangeSet(overrides: Partial<ChangeSetRecord> = {}): ChangeSetRecord {
  return { id: "cs-1", workspaceId: WORKSPACE_ID, status: "applied", summary: "Update widget", createdAt: "2026-10-01T00:00:00.000Z", ...overrides } as ChangeSetRecord;
}

/** One stored item of {@link fakeChangeSet}; its inverse is present, so it is revertible. */
export function fakeItem(overrides: Partial<ChangeSetItemRecord> = {}): ChangeSetItemRecord {
  return {
    id: "item-1", changeSetId: "cs-1", entityType: "post", entityId: "post-1", operation: "update",
    inversePayload: { title: "before" }, entityVersionAtApply: 2, position: 0, ...overrides,
  } as ChangeSetItemRecord;
}

/** Stand-ins for the host's DTO serializers: each tags its output so a test sees the injected one ran. */
export const toChangeSetHeader = ({ changeSet }: { changeSet: ChangeSetRecord }) => ({ header: changeSet.id, status: changeSet.status });
export const toChangeSetItem = ({ item }: { item: ChangeSetItemRecord }) => ({ item: item.id });

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

/** A route-input context as the host's adapter builds it. */
export const raw = (params: Record<string, string>, body: unknown = {}) => ({ body, query: {}, params });
