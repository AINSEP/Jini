import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/** Shared fakes for the AI Assistant execution-probe and visitor-tools spec tests. */
export const PREFIX = "/api/admin/v1/workspaces/:workspaceId/assistant";
export const PERMISSION = "admin.assistant.manage";
export const PRINCIPAL = { id: "admin-9" };
export const GOOGLE = "https://generativelanguage.googleapis.com";
export const signal = new AbortController().signal;
export const raw = (body: unknown) => ({ body, query: {}, params: { workspaceId: "ws-7" } });

/** An authorizer that records each check and optionally denies with the host's 403 refusal. */
export function recordingAuthorize({ deny = false }: { deny?: boolean } = {}) {
  const calls: unknown[] = [];
  const authorize = async (args: { permission: string; entityType: string }, scope?: unknown) => {
    calls.push(scope === undefined ? args : { ...args, scope });
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: "denied", code: "FORBIDDEN" } });
  };
  return { calls, authorize };
}

/** The refusal a pending handler rejected with; any other outcome fails the test. */
export async function refusal(pending: unknown): Promise<RouteRefusalError["response"]> {
  const error = await Promise.resolve(pending).then(() => undefined, (e: unknown) => e);
  if (!(error instanceof RouteRefusalError)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error.response;
}
