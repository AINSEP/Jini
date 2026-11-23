import assert from "node:assert/strict";
import { test } from "vitest";
import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { createSubscription, deleteSubscription, pauseSubscription, updateSubscription } from "../subscriptions.js";
import { InMemoryWebhookSubscriptionRepo } from "./memory-fixtures.js";

test("webhook edits forward the version read by the editor and reject a stale replacement", async () => {
  const repo = new InMemoryWebhookSubscriptionRepo();
  const deps = { repo, clock: { nowMs: () => 0 }, idGenerator: { newId: () => "sub" }, isAllowedTarget: async () => true };
  const { subscription } = await createSubscription({ deps, input: {
    workspaceId: "ws", ownerPrincipalId: "owner", createdByPrincipalId: "owner",
    label: "Original", targetUrl: "https://example.com/hook", topics: ["post.created"],
  } });
  const input = { workspaceId: "ws", id: subscription.id, targetUrl: subscription.targetUrl, topics: subscription.topics };
  const first = await updateSubscription({ deps, input: { ...input, label: "First" } }, { expectedVersion: 1 });
  await assert.rejects(updateSubscription({ deps, input: { ...input, label: "Second" } }, { expectedVersion: 1 }),
    (error: unknown) => error instanceof RecordVersionConflictError && error.currentVersion === 2);
  assert.equal(first.subscription.version, 2);
  assert.equal((await repo.findById({ workspaceId: "ws", id: subscription.id }))?.label, "First");
});

for (const { name, write } of [{ name: "pause", write: pauseSubscription }, { name: "delete", write: deleteSubscription }]) {
  test(`webhook ${name} rejects an edit committed between its read and save`, async () => {
    const repo = new InMemoryWebhookSubscriptionRepo();
    const deps = { repo, clock: { nowMs: () => 0 }, idGenerator: { newId: () => "sub" }, isAllowedTarget: async () => true };
    const { subscription } = await createSubscription({ deps, input: {
      workspaceId: "ws", ownerPrincipalId: "owner", createdByPrincipalId: "owner",
      label: "Original", targetUrl: "https://example.com/hook", topics: ["post.created"],
    } });
    const save = repo.save.bind(repo);
    repo.save = async (record, optional) => {
      await save({ ...subscription, label: "Edited", version: 2 }, { expectedVersion: 1 });
      return save(record, optional);
    };
    await assert.rejects(write({ deps, input: { workspaceId: "ws", id: subscription.id } }),
      (error: unknown) => error instanceof RecordVersionConflictError && error.currentVersion === 2);
    const current = await repo.findById({ workspaceId: "ws", id: subscription.id });
    assert.equal(current?.label, "Edited");
    assert.equal(current?.status, "active");
    assert.equal(current?.version, 2);
  });
}

test("webhook confirmed delete rejects a stale expectedVersion", async () => {
  const repo = new InMemoryWebhookSubscriptionRepo();
  const deps = { repo, clock: { nowMs: () => 0 }, idGenerator: { newId: () => "sub" }, isAllowedTarget: async () => true };
  const { subscription } = await createSubscription({ deps, input: {
    workspaceId: "ws", ownerPrincipalId: "owner", createdByPrincipalId: "owner",
    label: "Original", targetUrl: "https://example.com/hook", topics: ["post.created"],
  } });
  const input = { workspaceId: "ws", id: subscription.id };
  await updateSubscription({ deps, input: { ...input, label: "Edited", targetUrl: subscription.targetUrl, topics: subscription.topics } }, { expectedVersion: 1 });
  await assert.rejects(deleteSubscription({ deps, input }, { expectedVersion: 1 }),
    (error: unknown) => error instanceof RecordVersionConflictError && error.currentVersion === 2);
  const current = await repo.findById(input);
  assert.equal(current?.label, "Edited");
  assert.equal(current?.status, "active");
  assert.equal(current?.version, 2);
});

// B146: callers that omit expectedVersion still get compare-and-set on the version they read, so an
// update cannot silently overwrite a pause/delete that landed between its read and its save.
test("webhook update without expectedVersion rejects a pause committed between its read and save", async () => {
  const repo = new InMemoryWebhookSubscriptionRepo();
  const deps = { repo, clock: { nowMs: () => 0 }, idGenerator: { newId: () => "sub" }, isAllowedTarget: async () => true };
  const { subscription } = await createSubscription({ deps, input: {
    workspaceId: "ws", ownerPrincipalId: "owner", createdByPrincipalId: "owner",
    label: "Original", targetUrl: "https://example.com/hook", topics: ["post.created"],
  } });
  const save = repo.save.bind(repo);
  repo.save = async (record, optional) => {
    await save({ ...subscription, status: "paused", version: 2 }, { expectedVersion: 1 });
    return save(record, optional);
  };
  await assert.rejects(updateSubscription({ deps, input: { workspaceId: "ws", id: subscription.id, label: "Edited", targetUrl: subscription.targetUrl, topics: subscription.topics } }),
    (error: unknown) => error instanceof RecordVersionConflictError && error.currentVersion === 2);
  const current = await repo.findById({ workspaceId: "ws", id: subscription.id });
  assert.equal(current?.status, "paused");
  assert.equal(current?.label, "Original");
});
