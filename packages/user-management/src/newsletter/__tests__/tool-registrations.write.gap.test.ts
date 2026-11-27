import { afterEach, expect, it, vi } from "vitest";
import type { NewsletterToolDeps } from "../tool-registrations.js";
import { resendPendingSubscriptionConfirmation } from "../tool-registrations.write.js";
import { call, campaignRow, listRow, newsletterHarness, now, subscriptionRow } from "./tool-registrations.harness.js";

afterEach(() => { vi.restoreAllMocks(); });

/** Wires the real confirmation/subscription services onto the harness repos with a delivering mailer. */
function wired(options: Parameters<typeof newsletterHarness>[0] = {}) {
  const h = newsletterHarness(options);
  const deps = h.deps;
  const send = vi.fn(async () => ({ ok: true as const, providerMessageId: "pm", acceptedAt: now }));
  let driver = "smtp";
  deps.mailer = { ...deps.mailer, capabilities: () => ({ driver, supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }), send };
  deps.newsletterSubscriberDirectory = { getContact: async ({ subscriberId }) => (subscriberId.startsWith("person-") ? { subscriberId, workspaceId: "ws-1", email: `${subscriberId}@example.test`, emailDeliverable: true } : null), getContacts: async () => [] };
  const confirmation = (d: NewsletterToolDeps) => ({ tokenRepo: d.newsletterConfirmationTokenRepo, subscriptionRepo: d.newsletterSubscriptionRepo, mailer: d.mailer, consentCapability: null,
    originRegistry: d.originRegistry, clock: d.clock, ids: d.idGen, resolveFrom: async () => ({ email: "from@example.test" }), mintRawToken: () => "a".repeat(64), hashToken: () => "b".repeat(64) });
  deps.buildConfirmationDeps = ({ deps: d }) => confirmation(d);
  deps.buildSubscriptionsDeps = ({ deps: d }) => ({ subscriptionRepo: d.newsletterSubscriptionRepo, listRepo: d.newsletterListRepo, subscriberDirectory: d.newsletterSubscriberDirectory,
    confirmationDeps: confirmation(d), clock: d.clock, ids: d.idGen });
  return { ...h, send, setDriver: (value: string) => { driver = value; } };
}

it("newsletter_create_campaign writes an agent-created draft with a null preheader unless one is given", async () => {
  const { deps, authorize } = wired({ lists: [listRow("list-1")] });
  const out = await call({ deps, id: "newsletter_create_campaign", input: { subject: "Hello", fromName: "Team", fromEmail: "team@example.test", replyTo: "r@example.test", listId: "list-1", preheader: 7 } }) as { campaign: { id: string; status: string; preheader: string | null; subject: string } };
  expect(out.campaign).toMatchObject({ id: "new-id", status: "draft", preheader: null, subject: "Hello" });
  expect(await deps.newsletterCampaignRepo.findById({ workspaceId: "ws-1", id: "new-id" })).toMatchObject({ subject: "Hello", replyTo: "r@example.test", createdByPrincipal: "actor-1" });
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "admin.newsletter.campaign.compose" }));
  await expect(call({ deps, id: "newsletter_create_campaign", input: { subject: "No list" } })).rejects.toThrow();
});

it("newsletter_update_campaign replaces only the string fields given and refuses an unknown campaign", async () => {
  const { deps } = wired({ lists: [listRow("list-1"), listRow("list-2")], campaigns: [campaignRow("c1", { replyTo: "old@example.test" })] });
  const out = await call({ deps, id: "newsletter_update_campaign", input: { campaignId: "c1", subject: 5, fromName: "New", fromEmail: "new@example.test", replyTo: "new-r@example.test", listId: "list-2", preheader: "Pre" } }) as { campaign: Record<string, unknown> };
  expect(out.campaign).toMatchObject({ subject: "Subject c1", fromName: "New", fromEmail: "new@example.test", replyTo: "new-r@example.test", listId: "list-2", preheader: "Pre" });
  const kept = await call({ deps, id: "newsletter_update_campaign", input: { campaignId: "c1", preheader: 3 } }) as { campaign: Record<string, unknown> };
  expect(kept.campaign).toMatchObject({ fromName: "New", listId: "list-2", preheader: "Pre" });
  await expect(call({ deps, id: "newsletter_update_campaign", input: { campaignId: "nope" } })).rejects.toThrow(/^NEWSLETTER_CAMPAIGN_NOT_FOUND: campaign nope was not found/);
});

it("newsletter_cancel_campaign cancels a draft; newsletter_pause_campaign hands the send-pipeline deps the send permission's call", async () => {
  const { deps, authorize } = wired({ lists: [listRow("list-1")], campaigns: [campaignRow("c1")] });
  const out = await call({ deps, id: "newsletter_cancel_campaign", input: { campaignId: "c1" } }) as { campaign: { status: string } };
  expect(out.campaign.status).toBe("canceled");
  expect((await deps.newsletterCampaignRepo.findById({ workspaceId: "ws-1", id: "c1" }))?.status).toBe("canceled");
  const built = vi.fn((): never => { throw new Error("pipeline built"); });
  deps.buildSendPipelineDeps = built;
  await expect(call({ deps, id: "newsletter_pause_campaign", input: { campaignId: "c1" } })).rejects.toThrow();
  expect(authorize).toHaveBeenLastCalledWith(expect.objectContaining({ permission: "admin.newsletter.campaign.send" }));
  expect(built).toHaveBeenCalledWith(expect.objectContaining({ deps }));
});

it("newsletter_create_list and newsletter_archive_list manage list rows", async () => {
  const { deps, authorize } = wired({ lists: [listRow("default", { isDefault: true })] });
  expect(await call({ deps, id: "newsletter_create_list", input: { name: "Weekly", slug: "weekly" } })).toEqual({ list: { id: "new-id", name: "Weekly", slug: "weekly", isDefault: false, status: "active" } });
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ permission: "admin.newsletter.list.manage" }));
  expect(await call({ deps, id: "newsletter_archive_list", input: { listId: "new-id" } })).toMatchObject({ list: { id: "new-id", status: "archived" } });
  await expect(call({ deps, id: "newsletter_archive_list", input: { listId: "default" } })).rejects.toThrow(/^NEWSLETTER_DEFAULT_LIST_PROTECTED:/);
});

it("newsletter_create_subscription defaults the source to admin and mails a confirmation", async () => {
  const { deps, send } = wired({ lists: [listRow("list-1")] });
  const out = await call({ deps, id: "newsletter_create_subscription", input: { listId: "list-1", subscriberId: "person-a" } }) as { subscription: Record<string, unknown> };
  expect(out.subscription).toMatchObject({ listId: "list-1", subscriberId: "person-a", status: "pending", source: "admin" });
  const imported = await call({ deps, id: "newsletter_create_subscription", input: { listId: "list-1", subscriberId: "person-b", source: "import" } }) as { subscription: Record<string, unknown> };
  expect(imported.subscription.source).toBe("import");
  expect(send).toHaveBeenCalledTimes(2);
  await expect(call({ deps, id: "newsletter_create_subscription", input: { listId: "list-1", subscriberId: "ghost" } })).rejects.toThrow(/^NEWSLETTER_SUBSCRIBER_NOT_FOUND:/);
});

it("newsletter_remove_subscription unsubscribes only within the named list", async () => {
  const { deps } = wired({ subscriptions: [subscriptionRow("s1")] });
  await expect(call({ deps, id: "newsletter_remove_subscription", input: { listId: "other", subscriptionId: "s1" } })).rejects.toThrow(/^NEWSLETTER_SUBSCRIPTION_NOT_FOUND: subscription s1 was not found/);
  await expect(call({ deps, id: "newsletter_remove_subscription", input: { listId: "list-1", subscriptionId: "nope" } })).rejects.toThrow(/^NEWSLETTER_SUBSCRIPTION_NOT_FOUND:/);
  expect(await call({ deps, id: "newsletter_remove_subscription", input: { listId: "list-1", subscriptionId: "s1" } })).toMatchObject({ subscription: { id: "s1", status: "unsubscribed", unsubscribedAt: now } });
});

const mailOff = { delivered: false, mailDeliveryAvailable: false, note: "Email sending is not configured. Configure an SMTP credential or a mail adapter in Agent Plugins to send real email." };

it("newsletter_resend_confirmation reports mail-off for console/memory drivers before any lookup", async () => {
  const { deps, send, setDriver } = wired({ subscriptions: [subscriptionRow("s1", { status: "pending" })] });
  const findById = vi.spyOn(deps.newsletterSubscriptionRepo, "findById");
  for (const driver of ["memory", "console"]) {
    setDriver(driver);
    expect(await call({ deps, id: "newsletter_resend_confirmation", input: { subscriptionId: "s1" } })).toEqual(mailOff);
  }
  expect(findById).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("newsletter_resend_confirmation re-checks the driver after the abort check", async () => {
  const { deps } = wired({ subscriptions: [subscriptionRow("s1", { status: "pending" })] });
  const drivers = ["smtp", "memory"];
  deps.mailer = { ...deps.mailer, capabilities: () => ({ driver: drivers.shift() ?? "smtp", supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }) };
  expect(await call({ deps, id: "newsletter_resend_confirmation", input: { subscriptionId: "s1" } })).toEqual(mailOff);
});

it("newsletter_resend_confirmation mails a pending subscriber and acknowledges everything else identically", async () => {
  const { deps, send } = wired({ subscriptions: [subscriptionRow("s1", { status: "pending" }), subscriptionRow("s2"), subscriptionRow("s3", { status: "pending", subscriberId: "ghost" })] });
  const ack = { delivered: true, mailDeliveryAvailable: true };
  expect(await call({ deps, id: "newsletter_resend_confirmation", input: { subscriptionId: "s1" } })).toEqual(ack);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: { email: "person-s1@example.test" } }), expect.anything());
  for (const subscriptionId of ["s2", "s3", "missing"]) expect(await call({ deps, id: "newsletter_resend_confirmation", input: { subscriptionId } })).toEqual(ack);
  expect(send).toHaveBeenCalledTimes(1);
});

it("an aborted resend is abandoned after the contact lookup and before mailing", async () => {
  const { deps, send } = wired({ subscriptions: [subscriptionRow("s1", { status: "pending" })] });
  const controller = new AbortController();
  controller.abort();
  const abandoned = { confirmed: false, reason: "abandoned", delivered: false, mailDeliveryAvailable: true };
  expect(await resendPendingSubscriptionConfirmation({ deps, subscriptionId: "s1", signal: controller.signal })).toEqual(abandoned);
  expect(send).not.toHaveBeenCalled();
});

it("a failing confirmation is logged without contact details and still acknowledged", async () => {
  const { deps } = wired({ subscriptions: [subscriptionRow("s1", { status: "pending" })] });
  deps.buildConfirmationDeps = () => { throw new Error("smtp refused person-s1@example.test"); };
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await resendPendingSubscriptionConfirmation({ deps, subscriptionId: "s1", signal: new AbortController().signal })).toEqual({ delivered: true, mailDeliveryAvailable: true });
  expect(log).toHaveBeenCalledWith("[newsletter] confirmation request could not be processed; inspect mail configuration", expect.any(String));
});
