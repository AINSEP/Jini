import assert from "node:assert/strict";
import { test } from "vitest";
import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { createSubscription, updateSubscription } from "../subscriptions.js";
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
