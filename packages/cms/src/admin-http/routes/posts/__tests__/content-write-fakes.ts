import type { AuthorizeFn, OutboxPort } from "@jini-ai/core/contracts/events";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { InMemoryChangeSetRepo } from "../../../../core/commands/repo.memory.js";

/** @file Shared fakes for the posts/pages create, update and delete spec tests: the gateway deps, the host error classes and a fake entry store. */

export const WORKSPACE_ID = "ws-1";
export const PRINCIPAL = { id: "principal-1" };

export class FakeNotFound extends Error {}
export class FakeValidation extends Error {}
export class FakeConflict extends Error {}
export class FakeVersionConflict extends FakeConflict {}
export class FakeHookFailure extends Error {}

/** A stored entry: the version the gateway records, the kind the page routes check, and a title the serializer echoes. */
export interface FakeEntry { id: string; version: number; kind: "post" | "page"; title: string; deletedAt?: string }

/** The host error tests and the version-conflict body, over the fake classes. */
export const postErrors = {
  isValidation: ({ err }: { err: unknown }) => err instanceof FakeValidation,
  isConflict: ({ err }: { err: unknown }) => err instanceof FakeConflict,
  isVersionConflict: ({ err }: { err: unknown }) => err instanceof FakeVersionConflict,
  isNotFound: ({ err }: { err: unknown }) => err instanceof FakeNotFound,
  versionConflictBody: ({ err }: { err: unknown }) => ({ error: (err as Error).message, code: "VERSION_CONFLICT", currentVersion: 9 }),
};

/** The host's hook-failure binding: a flat 500 refusal for the fake hook class, nothing for anything else. */
export const rejectPluginHookFailure = ({ err }: { err: unknown }) => {
  if (err instanceof FakeHookFailure) throw new RouteRefusalError({ status: 500, body: { error: "hook refused", code: "PLUGIN_HOOK_FAILED", pluginId: "p1" } });
};

/** The raw input a host adapter hands `parse`; `headers` holds only the opted-in names. */
export const raw = (params: Record<string, string>, body: unknown = {}, headers?: Record<string, string>) => ({ body, query: {}, params, ...(headers ? { headers } : {}) });

/** The gateway deps over a real in-memory change-set repo, a recording authorizer and a counted drain. */
export function gatewayFixture({ allow = true }: { allow?: boolean } = {}) {
  let nextId = 0;
  const authCalls: Parameters<AuthorizeFn>[0][] = [];
  const changeSets = new InMemoryChangeSetRepo();
  const outbox = { enqueue: async () => {}, claimPending: async () => [], markDelivered: async () => {} } as unknown as OutboxPort;
  const drains: number[] = [];
  const authorize: AuthorizeFn = async (params) => {
    authCalls.push(params);
    return allow ? { allowed: true, reason: "ok" } : { allowed: false, reason: "test_denied" };
  };
  return {
    authCalls,
    changeSets,
    drains,
    base: {
      workspaceId: WORKSPACE_ID,
      commandDeps: { clock: { nowMs: () => Date.parse("2026-11-23T00:00:00.000Z") }, idGen: { newId: () => `id-${++nextId}` }, changeSets, outbox, authorize },
      drainOutbox: async () => { drains.push(1); },
      toAdminPostResponse: ({ post }: { post: { version: number } }) => ({ serialized: post }),
    },
  };
}

/** A fake entry store: lookups by id or slug-equals-title, a version bump on write, a trash marker on delete. */
export function entryStore(initial: FakeEntry[] = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const restored: string[] = [];
  return {
    rows,
    restored,
    findPostId: async ({ idOrSlug }: { workspaceId: string; idOrSlug: string }) => {
      const row = [...rows.values()].find((candidate) => candidate.id === idOrSlug || candidate.title === idOrSlug);
      if (!row) throw new FakeNotFound(`post '${idOrSlug}' was not found`);
      return row.id;
    },
    findEntry: async ({ id }: { workspaceId: string; id: string }) => rows.get(id) ?? null,
    restoreEntry: async ({ prior }: { prior: FakeEntry; actorId: string }) => { restored.push(prior.id); rows.set(prior.id, prior); },
    updateInverse: ({ prior }: { prior: FakeEntry }) => ({ title: prior.title }),
  };
}
