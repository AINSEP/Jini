import { expect, test } from "vitest";
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
