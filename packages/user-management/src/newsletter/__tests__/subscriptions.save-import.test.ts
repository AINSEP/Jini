import { expect, it, vi } from "vitest";
import { importSubscriptions, saveSubscription, unsubscribeSubscription, type SubscriptionsDeps } from "../subscriptions.js";
import { InMemoryNewsletterConfirmationTokenRepo, InMemoryNewsletterListRepo, InMemoryNewsletterSubscriptionRepo } from "../repo.memory.js";
import { NewsletterListNotFoundError, NewsletterSubscriberNotFoundError, NewsletterValidationError } from "../errors.js";
import type { NewsletterListRow, SubscriptionRow } from "../types.js";

const now = "2026-01-01T00:00:00.000Z";
const list = (id: string, status: NewsletterListRow["status"] = "active"): NewsletterListRow => ({ id, workspaceId: "w", name: id, slug: id, isDefault: false, status, createdAt: now, updatedAt: now });
const contacts: Record<string, string> = { ana: "ana@example.test", bo: "bo@example.test" };

function setup({ existing = [] }: { existing?: SubscriptionRow[] } = {}) {
  const subscriptionRepo = new InMemoryNewsletterSubscriptionRepo({}, { initialRows: existing });
  const tokenRepo = new InMemoryNewsletterConfirmationTokenRepo();
  const send = vi.fn(async () => ({ ok: true as const, providerMessageId: "mail", acceptedAt: now }));
  let id = 0;
  const deps: SubscriptionsDeps = {
    subscriptionRepo, listRepo: new InMemoryNewsletterListRepo({}, { initialRows: [list("news"), list("old", "archived")] }),
    subscriberDirectory: { getContact: async ({ subscriberId }) => (contacts[subscriberId] ? { subscriberId, email: contacts[subscriberId] } : null), getContacts: async () => [] },
    clock: { nowIso: () => now }, ids: { newId: () => `id-${++id}` },
    confirmationDeps: { tokenRepo, subscriptionRepo, consentCapability: null, clock: { nowIso: () => now }, ids: { newId: () => `tok-${++id}` },
      resolveFrom: async () => ({ email: "from@example.test" }), mintRawToken: () => "a".repeat(64), hashToken: () => "b".repeat(64),
      originRegistry: { canonicalOrigin: async () => ({ scheme: "https", host: "example.test", verifiedAt: now, source: "workspace-setting" }), isAllowedRedirectTarget: async () => true, isAllowedEgressTarget: async () => true },
      mailer: { capabilities: () => ({ driver: "memory", supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }), send, sendBatch: async () => [] } },
  };
  return { deps, subscriptionRepo, tokenRepo, send };
}

it("saveSubscription creates a pending row and mails a confirmation link to the contact", async () => {
  const { deps, subscriptionRepo, send } = setup();
  const { subscription } = await saveSubscription({ deps, input: { workspaceId: "w", listId: "news", subscriberId: "ana", source: "admin" } });
  expect(subscription).toEqual({ id: "id-1", workspaceId: "w", listId: "news", subscriberId: "ana", status: "pending", source: "admin",
    consentRevisionIdAtSubscribe: null, subscribedAt: null, unsubscribedAt: null, createdAt: now, updatedAt: now });
  expect(await subscriptionRepo.findById({ workspaceId: "w", id: "id-1" })).toEqual(subscription);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: { email: "ana@example.test" }, text: `Please confirm your subscription: https://example.test/newsletter/confirm?token=${"a".repeat(64)}` }), expect.anything());
});

it("saveSubscription re-sends confirmation for an existing row instead of duplicating it", async () => {
  const row: SubscriptionRow = { id: "keep", workspaceId: "w", listId: "news", subscriberId: "ana", status: "pending", source: "import", consentRevisionIdAtSubscribe: null, subscribedAt: null, unsubscribedAt: null, createdAt: "earlier", updatedAt: "earlier" };
  const { deps, send } = setup({ existing: [row] });
  expect((await saveSubscription({ deps, input: { workspaceId: "w", listId: "news", subscriberId: "ana", source: "admin" } })).subscription).toEqual(row);
  expect(send).toHaveBeenCalledTimes(1);
});

it("saveSubscription refuses an unknown list, an archived list and an unknown subscriber without writing", async () => {
  const { deps, subscriptionRepo, send } = setup();
  const save = vi.spyOn(subscriptionRepo, "save");
  await expect(saveSubscription({ deps, input: { workspaceId: "w", listId: "nope", subscriberId: "ana", source: "admin" } })).rejects.toThrow(NewsletterListNotFoundError);
  await expect(saveSubscription({ deps, input: { workspaceId: "w", listId: "nope", subscriberId: "ana", source: "admin" } })).rejects.toThrow("list nope was not found");
  const archived = saveSubscription({ deps, input: { workspaceId: "w", listId: "old", subscriberId: "ana", source: "admin" } });
  await expect(archived).rejects.toThrow(NewsletterValidationError);
  await expect(archived).rejects.toThrow("This list is archived.");
  await expect(saveSubscription({ deps, input: { workspaceId: "w", listId: "news", subscriberId: "ghost", source: "admin" } })).rejects.toThrow(new NewsletterSubscriberNotFoundError({ message: "subscriber ghost was not found", subscriberId: "ghost" }));
  expect(save).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("importSubscriptions routes every row through saveSubscription and reports per-row failures", async () => {
  const { deps, send } = setup();
  const out = await importSubscriptions({ deps, input: { workspaceId: "w", listId: "news", subscribers: [
    { subscriberId: "ana", source: "import" }, { subscriberId: "ghost", source: "import" }, { subscriberId: "bo", source: "import" }] } });
  expect(out.created.map(row => [row.subscriberId, row.status, row.source])).toEqual([["ana", "pending", "import"], ["bo", "pending", "import"]]);
  expect(out.failed).toEqual([{ index: 1, code: "NEWSLETTER_SUBSCRIBER_NOT_FOUND", message: "subscriber ghost was not found" }]);
  expect(send).toHaveBeenCalledTimes(2);
});

it("importSubscriptions reports an unexpected row failure as INTERNAL_ERROR and keeps going", async () => {
  const { deps } = setup();
  let calls = 0;
  deps.subscriberDirectory.getContact = async ({ subscriberId }) => { calls += 1; if (calls === 1) throw new Error("directory offline"); return { subscriberId, email: "x@example.test" }; };
  const out = await importSubscriptions({ deps, input: { workspaceId: "w", listId: "news", subscribers: [{ subscriberId: "ana", source: "import" }, { subscriberId: "bo", source: "import" }] } });
  expect(out.failed).toEqual([{ index: 0, code: "INTERNAL_ERROR", message: "directory offline" }]);
  expect(out.created).toHaveLength(1);
});

it("importSubscriptions refuses an empty or oversized batch and an archived list before any row", async () => {
  const { deps, subscriptionRepo } = setup();
  const save = vi.spyOn(subscriptionRepo, "save");
  const row = { subscriberId: "ana", source: "import" as const };
  for (const subscribers of [[], Array.from({ length: 501 }, () => row)]) {
    await expect(importSubscriptions({ deps, input: { workspaceId: "w", listId: "news", subscribers } })).rejects.toThrow("import batch must be between 1 and 500 rows");
  }
  await expect(importSubscriptions({ deps, input: { workspaceId: "w", listId: "old", subscribers: [row] } })).rejects.toThrow("This list is archived.");
  expect(save).not.toHaveBeenCalled();
  expect((await importSubscriptions({ deps, input: { workspaceId: "w", listId: "news", subscribers: Array.from({ length: 500 }, () => row) } })).created).toHaveLength(500);
});

it("unsubscribeSubscription refuses an unknown id and unsubscribes without a consent binding", async () => {
  const row: SubscriptionRow = { id: "s", workspaceId: "w", listId: "news", subscriberId: "ana", status: "subscribed", source: "admin", consentRevisionIdAtSubscribe: "r", subscribedAt: now, unsubscribedAt: null, createdAt: now, updatedAt: now };
  const repo = new InMemoryNewsletterSubscriptionRepo({}, { initialRows: [row] });
  const deps = { subscriptionRepo: repo, consentCapability: null, clock: { nowIso: () => "later" } };
  await expect(unsubscribeSubscription({ deps, input: { workspaceId: "w", id: "nope" } })).rejects.toThrow("subscription nope was not found");
  expect((await unsubscribeSubscription({ deps, input: { workspaceId: "w", id: "s" } })).subscription).toEqual({ ...row, status: "unsubscribed", unsubscribedAt: "later", updatedAt: "later" });
});
