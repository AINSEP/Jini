import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/** @file Shared fakes for the pages admin route-spec tests. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };

/** One recorded authorization: the permission, the entity type and, when a route names one, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`, so each test pins exactly what the route asks the host's authorizer. */
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

/** A route-input context as the host's adapter builds it: route params, and the JSON body when a test sends one. */
export const raw = (params: Record<string, string>, body: unknown = {}) => ({ body, query: {}, params });
