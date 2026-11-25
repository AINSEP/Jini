import { expect, test } from "vitest";
import {
  createRevertRegistry,
  InMemoryChangeSetRepo,
  revertChangeSet,
  RevertForbiddenError,
} from "@jini-ai/cms/core/commands";
import { type ChangeSetRecord, type ChangeSetItemRecord } from "@jini-ai/core/contracts/events";

test("public commands entry reverts in reverse order and preserves the agent force guard", async () => {
  const record: ChangeSetRecord = {
    id: "change", workspaceId: "workspace", status: "applied", summary: "Update",
    createdAt: "2026-11-07T00:00:00.000Z",
  };
  const items: ChangeSetItemRecord[] = [0, 1].map(position => ({
    id: `item-${position}`, changeSetId: record.id, entityType: "document", entityId: `doc-${position}`,
    operation: "update", position, entityVersionAtApply: 2, inversePayload: { value: "before" },
  }));
  const applied: string[] = [];
  const repo = new InMemoryChangeSetRepo([record], items);
  const registry = createRevertRegistry({}, {});
  registry.register("document", "update", {
    currentVersion: async () => 2,
    applyInverse: async ({ item }) => { applied.push(item.entityId); },
  });
  const deps = {
    changeSets: repo, registry, clock: { nowMs: () => Date.parse("2026-11-07T01:00:00.000Z") },
    idGen: { newId: () => "event" },
  };
  await expect(revertChangeSet({ deps, input: {
    workspaceId: "workspace", changeSetId: "change", force: true, principalKind: "agent",
  } }, {})).rejects.toBeInstanceOf(RevertForbiddenError);
  expect(applied).toEqual([]);
  expect(await repo.findById({ workspaceId: "other", id: "change" })).toBeNull();
  const reverted = await revertChangeSet({ deps, input: { workspaceId: "workspace", changeSetId: "change" } }, {});
  expect(applied).toEqual(["doc-1", "doc-0"]);
  expect(reverted.status).toBe("reverted");
  expect(reverted.revertedAt).toBe("2026-11-07T01:00:00.000Z");
  expect((await repo.findById({ workspaceId: "workspace", id: "change" }))?.changeSet).toEqual(reverted);
});

/**
 * Per-item policy seam. A grant to revert an ordinary audited change must not confer the write
 * authority a stricter kind needs, so a reverter that declares a policy is checked per item. The
 * policy comes from the registered reverter only, never from client input or the stored inverse.
 */
type PolicyFixtureOptions = { policy?: { permission: string; authorizationEntityType?: string; allowForce?: boolean }; version?: number };

function policyFixture(options: PolicyFixtureOptions = {}) {
  const record: ChangeSetRecord = {
    id: "change", workspaceId: "workspace", status: "applied", summary: "Update", actorId: "original-writer",
    createdAt: "2026-11-07T00:00:00.000Z",
  };
  const items: ChangeSetItemRecord[] = [
    { id: "plain-0", changeSetId: "change", entityType: "document", entityId: "doc-0", operation: "update", position: 0, entityVersionAtApply: 2, inversePayload: { value: "before" } },
    { id: "strict-1", changeSetId: "change", entityType: "raw-doc", entityId: "raw-1", operation: "update", position: 1, entityVersionAtApply: 2, inversePayload: { secret: "inverse body" } },
    { id: "strict-2", changeSetId: "change", entityType: "raw-doc", entityId: "raw-2", operation: "update", position: 2, entityVersionAtApply: 2, inversePayload: { secret: "inverse body" } },
  ];
  const log: string[] = [];
  const actors: Array<string | undefined> = [];
  const repo = new InMemoryChangeSetRepo([record], items);
  const registry = createRevertRegistry({}, {});
  registry.register("document", "update", {
    currentVersion: async ({ entityId }) => { log.push(`version:${entityId}`); return options.version ?? 2; },
    applyInverse: async ({ item }, extra) => { log.push(`write:${item.entityId}`); actors.push(extra?.actorId); },
  });
  registry.register("raw-doc", "update", {
    ...(options.policy ? { policy: options.policy } : {}),
    currentVersion: async ({ entityId }) => { log.push(`version:${entityId}`); return options.version ?? 2; },
    applyInverse: async ({ item }, extra) => { log.push(`write:${item.entityId}`); actors.push(extra?.actorId); },
  });
  const deps = { changeSets: repo, registry, clock: { nowMs: () => Date.parse("2026-11-07T01:00:00.000Z") }, idGen: { newId: () => "event" } };
  return { deps, repo, log, actors };
}

const STRICT = { permission: "documents.write_raw" } as const;

test("a reverter with a policy fails closed without an item authorizer", async () => {
  const { deps, log, repo } = policyFixture({ policy: STRICT });
  const error = await revertChangeSet({ deps, input: { workspaceId: "workspace", changeSetId: "change" } }, {}).catch((err: unknown) => err);
  expect(error).toBeInstanceOf(RevertForbiddenError);
  expect((error as RevertForbiddenError).reasonCode).toBe("ITEM_PERMISSION_DENIED");
  expect(log).toEqual([]);
  expect((await repo.findById({ workspaceId: "workspace", id: "change" }))?.changeSet.status).toBe("applied");
  // Unmarked kinds keep their behavior: with no policy, no authorizer is needed.
  const plain = policyFixture();
  await expect(revertChangeSet({ deps: plain.deps, input: { workspaceId: "workspace", changeSetId: "change" } }, {})).resolves.toMatchObject({ status: "reverted" });
});

test("the existing force guard runs first and a denied item prevents all current-version reads and inverse writes", async () => {
  const first = policyFixture({ policy: STRICT });
  const authorizerCalls: unknown[] = [];
  let repoRead = false;
  const watchedRepo = Object.assign(Object.create(first.repo) as InMemoryChangeSetRepo, { findById: async () => { repoRead = true; return null; } });
  const forced = await revertChangeSet(
    { deps: { ...first.deps, changeSets: watchedRepo }, input: { workspaceId: "workspace", changeSetId: "change", force: true, principalKind: "agent" } },
    { authorizeItem: async (call) => { authorizerCalls.push(call); } },
  ).catch((err: unknown) => err);
  expect((forced as RevertForbiddenError).reasonCode).toBe("AGENT_CANNOT_FORCE");
  expect([repoRead, authorizerCalls]).toEqual([false, []]);

  const { deps, log, repo } = policyFixture({ policy: STRICT });
  const seen: string[] = [];
  const denied = new RevertForbiddenError("You can't undo one of these changes.", "ITEM_PERMISSION_DENIED");
  await expect(revertChangeSet({ deps, input: { workspaceId: "workspace", changeSetId: "change" } }, {
    authorizeItem: async ({ entityId }) => { seen.push(entityId); if (entityId === "raw-1") throw denied; },
  })).rejects.toBe(denied);
  // Descending position: raw-2 is authorized, raw-1 (the second policy item) is denied; nothing was read or written.
  expect(seen).toEqual(["raw-2", "raw-1"]);
  expect(log).toEqual([]);
  expect((await repo.findById({ workspaceId: "workspace", id: "change" }))?.changeSet.status).toBe("applied");
});

test("the item authorizer receives the mapped entity kind and no inverse payload", async () => {
  const { deps, log, actors } = policyFixture({ policy: { permission: "documents.write_raw", authorizationEntityType: "document" } });
  const calls: unknown[] = [];
  await revertChangeSet({ deps, input: { workspaceId: "workspace", changeSetId: "change" } }, {
    actorId: "current-reverter",
    authorizeItem: async (...args) => { calls.push(args); },
  });
  expect(calls).toEqual([
    [{ permission: "documents.write_raw", entityType: "document", entityId: "raw-2" }],
    [{ permission: "documents.write_raw", entityType: "document", entityId: "raw-1" }],
  ]);
  expect(log).toEqual(["version:raw-2", "version:raw-1", "version:doc-0", "write:raw-2", "write:raw-1", "write:doc-0"]);
  expect(actors).toEqual(["current-reverter", "current-reverter", "current-reverter"]);
  // Without the mapping, the item's own kind is what gets authorized.
  const unmapped = policyFixture({ policy: STRICT });
  const kinds: string[] = [];
  await revertChangeSet({ deps: unmapped.deps, input: { workspaceId: "workspace", changeSetId: "change" } }, { authorizeItem: async ({ entityType }) => { kinds.push(entityType); } });
  expect(kinds).toEqual(["raw-doc", "raw-doc"]);
});

test("force remains available for existing kinds and is refused for a non-forceable inverse", async () => {
  const forceable = policyFixture({ policy: STRICT, version: 9 });
  await expect(revertChangeSet({ deps: forceable.deps, input: { workspaceId: "workspace", changeSetId: "change", force: true, principalKind: "user" } }, {
    authorizeItem: async () => {},
  })).resolves.toMatchObject({ status: "reverted" });
  expect(forceable.log.filter((entry) => entry.startsWith("write:"))).toHaveLength(3);

  const strict = policyFixture({ policy: { ...STRICT, allowForce: false }, version: 9 });
  const authorized: string[] = [];
  const refused = await revertChangeSet({ deps: strict.deps, input: { workspaceId: "workspace", changeSetId: "change", force: true, principalKind: "user" } }, {
    authorizeItem: async ({ entityId }) => { authorized.push(entityId); },
  }).catch((err: unknown) => err);
  expect(refused).toBeInstanceOf(RevertForbiddenError);
  expect((refused as RevertForbiddenError).reasonCode).toBe("ITEM_CANNOT_FORCE");
  expect((refused as Error).message).toMatch(/keep the newer version and edit it again/i);
  expect(strict.log).toEqual([]);
  // A non-forced revert of the same non-forceable kind still works when nothing changed since.
  const unchanged = policyFixture({ policy: { ...STRICT, allowForce: false } });
  await expect(revertChangeSet({ deps: unchanged.deps, input: { workspaceId: "workspace", changeSetId: "change" } }, { authorizeItem: async () => {} })).resolves.toMatchObject({ status: "reverted" });
});
