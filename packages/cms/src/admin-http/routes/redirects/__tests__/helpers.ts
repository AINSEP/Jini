import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { InMemoryOriginSettingRepo, OriginRegistry } from "@jini-ai/core/contracts/server/verified-origin";
import type { RedirectRecord, RedirectsWriteDeps } from "../../../../redirects/index.js";
import { redirectMatcher } from "../../../../redirects/matcher.js";
import type { RedirectDbHandle } from "../../../../redirects/ports.internal.js";
import { InMemoryRedirectRepo } from "../../../../redirects/repo.memory.js";
import { InMemoryOutbox } from "../../../../redirects/__tests__/support/events.fixture.js";
import { isNeverInTrash, removeVia, restoreVia } from "../../../../redirects/__tests__/remove-redirect-double.js";

/** @file Shared fakes for the redirects route-spec tests. */

export const WORKSPACE_ID = "ws-1";

/** One fixed rule record, so serialized DTOs can be pinned field by field. */
export function fakeRule(overrides: Partial<RedirectRecord> = {}): RedirectRecord {
  return {
    id: "red-1", workspaceId: WORKSPACE_ID, matchType: "exact", fromPattern: "/old", toTarget: "/new", statusCode: 301,
    status: "active", override: false, priority: 0, source: "manual", createdByPrincipal: "owner",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1, ...overrides,
  };
}

/** The serialized form of {@link fakeRule}: every optional field becomes an explicit `null`. */
export function fakeRuleDto(overrides: Partial<RedirectRecord> = {}): Record<string, unknown> {
  return { sourceEntryId: null, fromPathAtCapture: null, toPathAtCapture: null, createdByPluginId: null, ...fakeRule(overrides) };
}

/** One recorded authorization: the permission, the entity type and, for by-id routes, the entity id. */
export type RecordedAuthorize = { permission: string; entityType: string; entityId?: string };

/** A recording `authorize`, so each test pins the permission, entity type and entity id the route asks for. */
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

export const MANAGE = { permission: "admin.redirects.manage", entityType: "redirect" };
/** {@link MANAGE} scoped to one rule: the by-id routes forward the requested id to the authorizer. */
export const manageRule = (entityId: string): RecordedAuthorize => ({ ...MANAGE, entityId });
export const PRINCIPAL = { id: "principal-1" };
export const signal = new AbortController().signal;

/** Real write-chokepoint deps over an in-memory repo (same fixture as `redirects/__tests__/redirects.test.ts`),
 *  so the routes are pinned against the real `createRedirect`/`updateRedirect`/`tombstoneRedirect` rules. */
export function makeWriteDeps(): RedirectsWriteDeps & { repo: InMemoryRedirectRepo } {
  const repo = new InMemoryRedirectRepo();
  const originRepo = new InMemoryOriginSettingRepo({ seeds: [] });
  let clockTick = 0;
  let idTick = 0;
  return { reservedSegments: new Set(["admin", "api"]),
    repo,
    remove: removeVia(repo as unknown as Parameters<typeof removeVia>[0]),
    isInTrash: isNeverInTrash,
    restore: restoreVia(repo as unknown as Parameters<typeof removeVia>[0]),
    db: repo as unknown as RedirectDbHandle,
    transaction: async (fn) => fn(),
    matcher: redirectMatcher,
    originRegistry: new OriginRegistry({ repo: originRepo }),
    clock: { nowMs: () => Date.parse("2026-07-13T00:00:00.000Z") + 1000 * clockTick++ },
    idGen: { newId: () => `redirect-${++idTick}` },
    outbox: new InMemoryOutbox(),
  };
}
