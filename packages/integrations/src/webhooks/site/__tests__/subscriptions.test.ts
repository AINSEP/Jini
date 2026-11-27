import { describe, expect, it } from "vitest";
import { assertVersionedWrite } from "@jini-ai/core/optimistic-concurrency";
import { InMemoryWebhookSubscriptionRepo } from "../repo.memory.js";
import { createSubscription, deleteSubscription, pauseSubscription, updateSubscription, WebhookSubscriptionValidationError } from "../subscriptions.js";

function wire(allowed: (url: string) => boolean = () => true) {
  let now = "2026-05-06T07:08:09.000Z";
  let next = 0;
  const checked: string[] = [];
  const repo = new InMemoryWebhookSubscriptionRepo({ assertVersionedWrite });
  const deps = { clock: { nowIso: () => now }, repo, idGenerator: { newId: () => `id-${++next}` },
    isAllowedTarget: async ({ url }: { url: string }) => { checked.push(url); return allowed(url); } };
  return { deps, repo, checked, setNow: (iso: string) => { now = iso; } };
}
const input = { workspaceId: "ws-1", ownerPrincipalId: "p-1", label: "Hook", targetUrl: "https://example.com/a", topics: ["post.published"], createdByPrincipalId: "p-1" };

describe("site webhook subscription adapters", () => {
  it("create stamps the host ISO clock and keeps plugin attribution only when given", async () => {
    const w = wire();
    const { subscription } = await createSubscription({ deps: w.deps, input: { ...input, createdByPluginId: "plug-1" } });
    expect(subscription).toMatchObject({ workspaceId: "ws-1", label: "Hook", status: "active", createdAt: "2026-05-06T07:08:09.000Z", createdByPluginId: "plug-1" });
    expect(w.checked).toEqual(["https://example.com/a"]);
    const { subscription: plain } = await createSubscription({ deps: w.deps, input });
    expect(plain.createdByPluginId ?? null).toBeNull();
  });

  it("update re-checks the target through the host predicate and refuses a disallowed one", async () => {
    const w = wire(url => !url.includes("internal"));
    const { subscription } = await createSubscription({ deps: w.deps, input });
    w.setNow("2026-05-07T00:00:00.000Z");
    const { subscription: updated } = await updateSubscription({ deps: w.deps, input: { workspaceId: "ws-1", id: subscription.id, label: "Renamed", targetUrl: "https://example.com/b", topics: ["post.*"] } });
    expect(updated).toMatchObject({ label: "Renamed", targetUrl: "https://example.com/b", updatedAt: "2026-05-07T00:00:00.000Z", version: subscription.version + 1 });
    await expect(updateSubscription({ deps: w.deps, input: { workspaceId: "ws-1", id: subscription.id, label: "X", targetUrl: "https://internal.test/", topics: ["post.*"] } }))
      .rejects.toBeInstanceOf(WebhookSubscriptionValidationError);
    expect(w.checked).toEqual(["https://example.com/a", "https://example.com/b", "https://internal.test/"]);
  });

  it("pause and resume toggle status; delete disables and blocks later pausing", async () => {
    const w = wire();
    const { subscription } = await createSubscription({ deps: w.deps, input });
    expect((await pauseSubscription({ deps: w.deps, input: { workspaceId: "ws-1", id: subscription.id } })).subscription.status).toBe("paused");
    expect((await pauseSubscription({ deps: w.deps, input: { workspaceId: "ws-1", id: subscription.id } }, { paused: false })).subscription.status).toBe("active");
    w.setNow("2026-05-08T00:00:00.000Z");
    const { subscription: deleted } = await deleteSubscription({ deps: w.deps, input: { workspaceId: "ws-1", id: subscription.id } });
    expect(deleted).toMatchObject({ status: "disabled", disabledAt: "2026-05-08T00:00:00.000Z" });
    await expect(pauseSubscription({ deps: w.deps, input: { workspaceId: "ws-1", id: subscription.id } })).rejects.toThrow("is disabled and cannot be paused or resumed");
  });
});
