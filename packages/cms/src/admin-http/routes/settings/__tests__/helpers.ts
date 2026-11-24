import type { JsonRouteAuthorize, JsonRouteSpec } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { InMemorySettingsRepo } from "@jini-ai/core/settings";

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;
export const CROSS_READ = "test.settings.user.read";

/** The fence policy a host would bind (test values, so a hard-coded default cannot pass). */
export const FENCE = {
  protected: { namespaces: ["test.owner-only"], error: "TEST owner-only reason." },
  codeOwned: { namespaces: ["test.code-owned"], code: "TEST_CODE_OWNED", error: "TEST code-owned reason." },
};

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
export const raw = (query: Record<string, unknown> = {}, body: unknown = {}) => ({ body, query, params: { workspaceId: WORKSPACE_ID } });

/** The base deps every settings spec reads, with a resolved readiness promise and an empty ledger. */
export function baseDeps() {
  return { workspaceId: WORKSPACE_ID, settingsReady: Promise.resolve(), settingsRepo: new InMemorySettingsRepo(), writeFence: FENCE };
}

/** Parse then handle, as the host's mount does after its ports. */
export async function invoke<I, O, D, C>(
  route: JsonRouteSpec<I, O, D, C>,
  { deps, query = {}, body = {}, authorize = recordingAuthorize().authorize, context = PRINCIPAL as C }: { deps: D; query?: Record<string, unknown>; body?: unknown; authorize?: JsonRouteAuthorize | undefined; context?: C | undefined },
): Promise<O> {
  const parsed = await route.parse(raw(query, body));
  if (!parsed.ok) throw new Error("settings parse never refuses");
  const result = await route.handle({ input: parsed.value, deps, context: context as C, authorize }, { signal });
  if (!result.ok) throw new Error("settings handle never returns a failure");
  return result.value;
}
