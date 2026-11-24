import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/** @file Shared fakes for the comments route-spec tests. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** One recorded authorization: the permission, the entity type and, for per-comment routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize` that refuses the `deny` permission by throwing, as a host authorizer does. */
export function recordingAuthorize(
  { deny }: { deny?: string } = {},
): { authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[] } {
  const calls: RecordedAuthorize[] = [];
  return { calls, authorize: async ({ permission, entityType }, optional = {}) => {
    calls.push({ permission, entityType, ...optional });
    if (permission === deny) throw new Error(`denied ${permission}`);
  } };
}

/** Run `fn` and return the refusal it throws (status + body); fails if it does not refuse. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof RouteRefusalError) return error.response;
    throw error;
  }
  throw new Error("expected a route refusal");
}

/** A raw request shape for `parse`. */
export const raw = ({ params = {}, body, query = {} }: { params?: Record<string, string>; body?: unknown; query?: Record<string, unknown> }) => ({ body, query, params });
