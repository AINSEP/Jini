import type { OutboxPort } from "@jini-ai/core/contracts/events";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { InMemoryMenuRepo, InMemoryNavLocationBindingRepo } from "../../../../navigation/repo.memory.js";

/** @file Shared fakes for the menus route-spec tests. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** One recorded authorization: the permission, the entity type and, for by-id routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`, so each test pins the permission, entity type and entity id the route asks for. */
export function recordingAuthorize(
  { deny }: { deny?: string } = {},
): { authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: RecordedAuthorize[] } {
  const calls: RecordedAuthorize[] = [];
  return { calls, authorize: async ({ permission, entityType }, optional = {}) => {
    calls.push({ permission, entityType, ...optional });
    if (permission === deny) throw new Error(`denied ${permission}`);
  } };
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

/** A raw request shape for `parse`. */
export const raw = (params: Record<string, string>, body?: unknown) => ({ body, query: {}, params });

/** The write collaborators the menu service needs, over in-memory repos. */
export function makeMenuDeps() {
  let idTick = 0;
  const enqueued: unknown[] = [];
  const outbox: OutboxPort = {
    enqueue: async (event) => { enqueued.push(event); },
    claimPending: async () => [],
    markDelivered: async () => {},
    markFailed: async () => {},
  };
  return {
    workspaceId: WORKSPACE_ID,
    menuRepo: new InMemoryMenuRepo({}),
    navLocationBindingRepo: new InMemoryNavLocationBindingRepo({}),
    clock: { nowMs: () => Date.parse("2026-07-10T00:00:00.000Z"), nowIso: () => "2026-07-10T00:00:00.000Z" },
    idGen: { newId: () => `id-${++idTick}` },
    outbox,
    enqueued,
    normalizeMenuHtml: ({ html }: { html: string }) => `<!--n-->${html}`,
  };
}
