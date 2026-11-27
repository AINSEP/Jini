import { expect, it, vi } from "vitest";
import { buildNewsletterRegistrations, contributeNewsletterTools, newsletterDerivedRisk } from "../tool-registrations.js";
import { toNewsletterSendPipelineDeps } from "../tool-registrations.deps.js";
import { call, campaignRow, listRow, newsletterHarness, sendRow, subscriptionRow } from "./tool-registrations.harness.js";

it("registers every catalog tool with its derived risk, and contributes under the newsletter domain", () => {
  const { deps } = newsletterHarness();
  const registrations = buildNewsletterRegistrations(deps);
  expect(registrations.map(row => row.descriptor.id).sort()).toEqual([...newsletterDerivedRisk.keys()].sort());
  const contributor = contributeNewsletterTools();
  expect(contributor.domain).toBe("newsletter");
  expect(contributor.risk).toBe(newsletterDerivedRisk);
  expect(contributor.build(deps, { surfaceExchanges: { open: vi.fn(), deliver: vi.fn(), findTypedAnswerTarget: vi.fn(), size: vi.fn() } }).map(row => row.descriptor.id)).toEqual(registrations.map(row => row.descriptor.id));
});

it("newsletter_list_campaigns asks for the read permission, filters by status and hides plumbing fields", async () => {
  const { deps, authorize } = newsletterHarness({ campaigns: [campaignRow("c1"), campaignRow("c2", { status: "sent" })] });
  const out = await call({ deps, id: "newsletter_list_campaigns", input: { status: "sent" } }) as { campaigns: Record<string, unknown>[] };
  expect(out.campaigns.map(row => row.id)).toEqual(["c2"]);
  expect(Object.keys(out.campaigns[0] ?? {})).not.toContain("audienceSnapshotId");
  expect(Object.keys(out.campaigns[0] ?? {})).not.toContain("workspaceId");
  expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ principalId: "actor-1", permission: "admin.newsletter.read", workspaceId: "ws-1" }));
  expect(((await call({ deps, id: "newsletter_list_campaigns", input: {} })) as { campaigns: unknown[] }).campaigns).toHaveLength(2);
});

it("newsletter_get_campaign returns the tool view and reports a missing id with its domain code", async () => {
  const { deps } = newsletterHarness({ campaigns: [campaignRow("c1", { preheader: "Pre" })] });
  expect(await call({ deps, id: "newsletter_get_campaign", input: { campaignId: "c1" } })).toEqual({ campaign: {
    id: "c1", status: "draft", subject: "Subject c1", preheader: "Pre", fromName: "Sender", fromEmail: "sender@example.test", replyTo: "reply@example.test", listId: "list-1",
    scheduledAt: null, counters: { recipients: 0, delivered: 0, failed: 0, bounced: 0, complained: 0, unsubscribed: 0 }, version: 1, createdAt: campaignRow("c1").createdAt, updatedAt: campaignRow("c1").updatedAt } });
  await expect(call({ deps, id: "newsletter_get_campaign", input: { campaignId: "nope" } })).rejects.toThrow(/^NEWSLETTER_CAMPAIGN_NOT_FOUND: campaign nope was not found/);
});

it("a denied principal gets the forbidden code and no data", async () => {
  const { deps } = newsletterHarness({ campaigns: [campaignRow("c1")], allowed: false });
  await expect(call({ deps, id: "newsletter_get_campaign", input: { campaignId: "c1" } })).rejects.toThrow(/^NEWSLETTER_FORBIDDEN:/);
});

it("newsletter_list_lists and newsletter_list_subscriptions return model views under their own permissions", async () => {
  const { deps, authorize } = newsletterHarness({ lists: [listRow("list-1", { isDefault: true })], subscriptions: [subscriptionRow("s1"), subscriptionRow("s2", { listId: "other" })] });
  expect(await call({ deps, id: "newsletter_list_lists", input: {} })).toEqual({ lists: [{ id: "list-1", name: "List list-1", slug: "list-1", isDefault: true, status: "active" }] });
  const subs = await call({ deps, id: "newsletter_list_subscriptions", input: { listId: "list-1" } }) as { subscriptions: unknown[] };
  expect(subs.subscriptions).toEqual([{ id: "s1", listId: "list-1", subscriberId: "person-s1", status: "subscribed", source: "admin", subscribedAt: subscriptionRow("s1").subscribedAt, unsubscribedAt: null }]);
  expect(authorize).toHaveBeenLastCalledWith(expect.objectContaining({ permission: "admin.newsletter.subscriber.read" }));
});

it("newsletter_list_send_log pages by id with a continuation cursor and refuses an unknown campaign", async () => {
  const sends = ["a", "b", "c"].map(id => sendRow(id));
  const { deps } = newsletterHarness({ campaigns: [campaignRow("c1")], sends });
  const first = await call({ deps, id: "newsletter_list_send_log", input: { campaignId: "c1", limit: 2 } }) as { sends: { id: string }[]; nextCursor: string | null; truncated: boolean };
  expect(first.sends.map(row => row.id)).toEqual(["a", "b"]);
  expect(first.truncated).toBe(true);
  expect(Object.keys(first.sends[0] ?? {})).not.toContain("idempotencyKey");
  const second = await call({ deps, id: "newsletter_list_send_log", input: { campaignId: "c1", limit: 2, cursor: first.nextCursor } }) as typeof first;
  expect(second.sends.map(row => row.id)).toEqual(["c"]);
  expect(second).toMatchObject({ nextCursor: null, truncated: false });
  await expect(call({ deps, id: "newsletter_list_send_log", input: { campaignId: "nope" } })).rejects.toThrow(/^NEWSLETTER_CAMPAIGN_NOT_FOUND: campaign nope was not found/);
});

it("send-pipeline deps default the launch setting to off and pass a bound one through", async () => {
  const { deps } = newsletterHarness();
  const seen: boolean[] = [];
  deps.buildSendPipelineDeps = ({ isSendingEnabled }) => { void isSendingEnabled("ws-1").then(value => seen.push(value)); throw new Error("captured"); };
  expect(() => toNewsletterSendPipelineDeps(deps)).toThrow("captured");
  deps.newsletterSendingEnabled = async () => true;
  expect(() => toNewsletterSendPipelineDeps(deps)).toThrow("captured");
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(seen).toEqual([false, true]);
});
