import { expect, test, vi } from "vitest";
import type { ChangeSetItemRecord, ChangeSetRecord, DomainEvent } from "@jini-ai/core/contracts/events";
import { createRevertRegistry } from "../appliers.js";
import { InMemoryChangeSetRepo } from "../repo.memory.js";
import { revertChangeSet, type RevertChangeSetDeps } from "../revert.js";

test("L079: a later inverse failure rolls back earlier writes.", async () => {
  const record: ChangeSetRecord = { id: "change", workspaceId: "workspace", status: "applied", summary: "Update two rows", createdAt: "2026-11-26T00:00:00.000Z" };
  const items: ChangeSetItemRecord[] = [0, 1].map(position => ({ id: `item-${position}`, changeSetId: record.id,
    entityType: "document", entityId: `doc-${position}`, operation: "update", position, entityVersionAtApply: 2, inversePayload: { value: "before" } }));
  const changeSets = new InMemoryChangeSetRepo([record], items);
  let values: Record<string, string> = { "doc-0": "original-0", "doc-1": "original-1" };
  const original = { ...values };
  const events: DomainEvent[] = [];
  const attempts: string[] = [];
  const sentinel = new Error("second inverse failed");
  let active = false;
  const registry = createRevertRegistry({});
  registry.register("document", "update", { currentVersion: async () => 2, applyInverse: async ({ item }) => {
    attempts.push(item.entityId);
    if (item.entityId === "doc-0") {
      expect(active).toBe(true);
      expect(values["doc-1"]).toBe("reverted-1");
      throw sentinel;
    }
    values[item.entityId] = "reverted-1";
  } });
  const deps: RevertChangeSetDeps = { changeSets, registry, clock: { nowMs: () => 0 }, idGen: { newId: () => "event" },
    outbox: { enqueue: async event => { events.push(event); }, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
    transaction: async ({ work }) => {
      const snapshot = { ...values };
      active = true;
      try { return await work(); }
      catch (error) { values = snapshot; throw error; }
      finally { active = false; }
    } };
  await expect(revertChangeSet({ deps, input: { workspaceId: "workspace", changeSetId: "change", actor: { id: "reverter", kind: "user" } } })).rejects.toBe(sentinel);
  expect(attempts).toEqual(["doc-1", "doc-0"]);
  expect(values).toEqual(original);
  expect((await changeSets.findById({ workspaceId: "workspace", id: "change" }))?.changeSet).toEqual(record);
  expect(events).toEqual([]);
});

test("L079: an outbox failure rolls back both inverses and the reverted change set.", async () => {
  const record: ChangeSetRecord = { id: "change", workspaceId: "workspace", status: "applied", summary: "Update two rows", createdAt: "2026-11-26T00:00:00.000Z" };
  const items: ChangeSetItemRecord[] = [0, 1].map(position => ({ id: `item-${position}`, changeSetId: record.id,
    entityType: "document", entityId: `doc-${position}`, operation: "update", position, entityVersionAtApply: 2, inversePayload: { value: "before" } }));
  const changeSets = new InMemoryChangeSetRepo([record], items);
  const key = { workspaceId: record.workspaceId, id: record.id };
  let values: Record<string, string> = { "doc-0": "original-0", "doc-1": "original-1" };
  const original = { ...values };
  const sentinel = new Error("outbox failed");
  let active = false;
  const registry = createRevertRegistry({});
  registry.register("document", "update", { currentVersion: async () => 2, applyInverse: async ({ item }) => {
    values[item.entityId] = `reverted-${item.position}`;
  } });
  const deps: RevertChangeSetDeps = { changeSets, registry, clock: { nowMs: () => 0 }, idGen: { newId: () => "event" },
    outbox: { enqueue: async () => {
      expect(active).toBe(true);
      expect(values).toEqual({ "doc-0": "reverted-0", "doc-1": "reverted-1" });
      expect((await changeSets.findById(key))?.changeSet.status).toBe("reverted");
      throw sentinel;
    }, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} },
    transaction: async ({ work }) => {
      const snapshot = { ...values };
      const row = { ...(await changeSets.findById(key))!.changeSet };
      active = true;
      try { return await work(); }
      catch (error) { values = snapshot; await changeSets.save(row); throw error; }
      finally { active = false; }
    } };
  await expect(revertChangeSet({ deps, input: { workspaceId: key.workspaceId, changeSetId: key.id, actor: { id: "reverter", kind: "user" } } })).rejects.toBe(sentinel);
  expect(values).toEqual(original);
  expect((await changeSets.findById(key))?.changeSet).toEqual(record);
});

function preflight(inverse: Pick<ChangeSetItemRecord, "inversePayload"> = { inversePayload: { title: "prior title" } }) {
  const record: ChangeSetRecord = { id: "change-preflight", workspaceId: "ws-4", status: "applied", summary: "Rename report", createdAt: "2026-11-26T00:00:00.000Z" };
  const item: ChangeSetItemRecord = { id: "item-4", changeSetId: record.id, entityType: "document", entityId: "doc-9",
    operation: "update", position: 0, entityVersionAtApply: 2, ...inverse };
  const changeSets = new InMemoryChangeSetRepo([record], [item]);
  const currentVersion = vi.fn(async () => 2);
  const applyInverse = vi.fn(async () => {});
  const registry = createRevertRegistry({});
  registry.register("document", "update", { currentVersion, applyInverse });
  const deps: RevertChangeSetDeps = { changeSets, registry, clock: { nowMs: () => 0 }, idGen: { newId: () => "event" }, transaction: ({ work }) => work() };
  const input = { workspaceId: "ws-4", changeSetId: "change-preflight", actor: { id: "editor", kind: "user" as const } };
  return { deps, input, record, changeSets, currentVersion, applyInverse };
}

test("refuses an untyped forced revert before opening the transaction or reading versions", async () => {
  const f = preflight();
  const transactions: string[] = [];
  const transaction: RevertChangeSetDeps["transaction"] = ({ work }) => { transactions.push("opened"); return work(); };
  await expect(revertChangeSet({ deps: { ...f.deps, transaction }, input: { ...f.input, force: true } })).rejects.toMatchObject({
    message: "a forced revert must say who is asking; retry without force or sign in again",
    reasonCode: "FORCE_NEEDS_PRINCIPAL_KIND",
  });
  expect(transactions).toEqual([]);
  expect(f.currentVersion.mock.calls).toEqual([]);
});

test("refuses an item with no inverse before reading live versions or flipping the change set", async () => {
  const f = preflight({});
  await expect(revertChangeSet({ deps: f.deps, input: f.input }))
    .rejects.toThrow("change-set item 'item-4' has no inverse payload and cannot be reverted");
  expect(f.currentVersion.mock.calls).toEqual([]);
  expect(f.applyInverse.mock.calls).toEqual([]);
  expect((await f.changeSets.findById({ workspaceId: "ws-4", id: "change-preflight" }))?.changeSet).toEqual(f.record);
});

test("does not overwrite or announce a revert already finalized by a concurrent writer", async () => {
  const f = preflight();
  const concurrent = { ...f.record, status: "reverted" as const, revertedAt: "2026-11-26T01:00:00.000Z" };
  const registry = createRevertRegistry({});
  registry.register("document", "update", {
    currentVersion: f.currentVersion,
    applyInverse: async () => { await f.changeSets.save(concurrent); },
  });
  const enqueue = vi.fn(async () => {});
  await expect(revertChangeSet({
    deps: { ...f.deps, registry, outbox: { enqueue, claimPending: async () => [], markDelivered: async () => {}, markFailed: async () => {} } },
    input: f.input,
  })).rejects.toThrow("change set 'change-preflight' was already reverted concurrently");
  expect((await f.changeSets.findById({ workspaceId: "ws-4", id: "change-preflight" }))?.changeSet).toEqual(concurrent);
  expect(enqueue.mock.calls).toEqual([]);
});
