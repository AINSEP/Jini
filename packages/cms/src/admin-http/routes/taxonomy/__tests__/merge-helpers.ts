import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

/** The session principal the host's authenticate port supplies. */
export const MERGE_PRINCIPAL = { id: "operator" };

/** Builds the raw request a spec's `parse` receives. */
export function mergeRaw({ params = { id: "term-1" }, body }: { params?: Record<string, string>; body?: unknown }, _optional = {}) {
  return { params, query: {}, body } as never;
}

/** The `{ status, body }` a refusal answers with; any other throw is a test failure. */
export async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try { await fn(); } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error("expected a route refusal");
}

/** An authorize handle that must never be called: the merge ceremony gates inside the gateway. */
export const failingAuthorize = async (): Promise<void> => { throw new Error("merge routes must not call the host authorize port"); };
