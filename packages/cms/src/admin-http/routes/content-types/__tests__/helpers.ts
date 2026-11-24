import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { InMemoryContentTypeRepo, NoopContentTypeIndexProvisioner } from "../../../../content-types/index.js";
import { InMemoryEntryRepo } from "../../../../entries/index.js";

/** @file Shared fakes for the Collections (content-types + entries) route-spec tests. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "operator", kind: "user" as const };
export const signal = new AbortController().signal;
export const READ = { permission: "admin.collections.read" };
export const MANAGE = { permission: "admin.collections.manage" };

/** A recording route-gate `authorize`, so each test pins the permission and entity type asked for. */
export function recordingAuthorize(): { authorize: (r: { permission: string; entityType: string }, o?: { entityId?: string }) => Promise<void>; calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, authorize: async (required, optional) => { calls.push(optional === undefined ? required : { ...required, ...optional }); } };
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

/** Real in-memory collaborators behind every write route's deps, plus counters for the outbox drain. */
export function makeDeps(overrides: { allowed?: boolean } = {}) {
  const events: Array<{ name: string }> = [];
  let tick = 0;
  let drains = 0;
  const deps = {
    workspaceId: WORKSPACE_ID,
    outwardErrorMessage: ({ error }: { error: Error }) => error.message,
    authorize: async () => ({ allowed: overrides.allowed ?? true, reason: overrides.allowed === false ? "no_grant" : "matched" }),
    clock: { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") + 1000 * tick, nowIso: () => new Date(Date.parse("2026-07-13T00:00:00.000Z") + 1000 * tick++).toISOString() },
    idGen: { newId: () => `id-${++tick}` },
    // Only `enqueue` is exercised; the delivery half belongs to the host's drain (`drainOutbox`).
    outbox: { enqueue: async (event: { name: string }) => { events.push(event); }, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
    contentTypeRepo: new InMemoryContentTypeRepo(),
    contentTypeIndexProvisioner: new NoopContentTypeIndexProvisioner(),
    entryRepo: new InMemoryEntryRepo(),
    drainOutbox: async () => { drains++; },
  };
  return { deps, events, drains: () => drains };
}

export const RECIPE_FIELDS = [{ name: "title", kind: "text", required: false, queryable: false }];
