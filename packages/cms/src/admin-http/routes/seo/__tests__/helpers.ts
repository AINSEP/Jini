import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/** @file Shared fakes for the seo route-spec tests: a recording authorizer, the refusal reader and raw parse input. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };

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
export const raw = (params: Record<string, string>, body: unknown = {}) => ({ body, query: {}, params });

/** A readiness gate the test opens by hand, to pin that a route waits for it before authorizing. */
export function gate(): { ready: Promise<void>; open: () => void } {
  let open = () => {};
  const ready = new Promise<void>((resolve) => { open = resolve; });
  return { ready, open };
}
