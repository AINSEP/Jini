import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import type { MediaRecord } from "../../../../media/types.js";

/** @file Shared fakes for the media admin route-spec tests. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** One recorded authorization: the permission, the entity type and, for by-id routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`, so each test pins the permission, entity type and entity id the route asks for. */
export function recordingAuthorize(): { authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[] } {
  const calls: RecordedAuthorize[] = [];
  return { calls, authorize: async ({ permission, entityType }, optional = {}) => { calls.push({ permission, entityType, ...optional }); } };
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

/** A route-input context with only route params set, as the host's adapter builds it. */
export const raw = (params: Record<string, string>) => ({ body: {}, query: {}, params });

/** One fixed media record, so the trash display snapshot and version can be pinned. */
export function fakeMedia(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id: "asset-1", workspaceId: WORKSPACE_ID, title: "Sunset", slug: "sunset", status: "active", version: 3,
    ...overrides,
  } as MediaRecord;
}
