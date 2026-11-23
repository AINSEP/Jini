import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/** @file Shared fakes for the widgets route-spec tests. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** An `authorize` dep (the domain functions' RBAC check) that allows or denies with a fixed reason. */
export function rbac(allowed: boolean): { authorize: (params: { principalId: string; permission: string; workspaceId: string }) => Promise<{ allowed: boolean; reason: string }>; calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, authorize: async (params) => { calls.push(params); return { allowed, reason: allowed ? "matched" : "denied" }; } };
}

/** A recording authorize port; `deny` makes it refuse the way a host port does (403 refusal). */
export function recordingPort({ deny = false }: { deny?: boolean } = {}): { authorize: (r: { permission: string; entityType: string }) => Promise<void>; calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, authorize: async (required) => {
    calls.push(required);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: "denied", code: "FORBIDDEN" } });
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

/** A denied `widgets.*` check as the domain functions answer it. */
export const forbidden = (permission: string) => ({
  status: 403,
  body: { error: `principal 'principal-1' lacks permission '${permission}' (denied)`, code: "WIDGETS_FORBIDDEN", details: { permission, reason: "denied" } },
});

/** A widget entry row as the entry repository stores it. */
export function widgetEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "w-1", workspaceId: WORKSPACE_ID, type: "widget", title: "Hello", slug: "hello", status: "draft", version: 2,
    fieldsJson: { widgetType: "text", status: "active", config: { body: "hi" } }, updatedAt: "2026-01-01T00:00:00.000Z", ...overrides,
  };
}
