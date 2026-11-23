import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/** @file Shared fakes for the publish-content transport route-spec tests (peers, destination). */

export const WORKSPACE_ID = "ws-1";

/** One recorded authorization: the permission and entity type (these routes send no entity id). */
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
export const raw = (params: Record<string, string | undefined>, body: unknown = {}) => ({ body, query: {}, params: params as Record<string, string> });

/** A peer as the host's store would summarize it. */
export const PEER = { id: "p1", label: "Live", baseUrl: "https://live.example", remoteWorkspaceId: "rw", masked: "****abcd", hasCredential: true } as const;
