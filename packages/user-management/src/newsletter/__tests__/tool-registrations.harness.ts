import { vi } from "vitest";
import type { ToolExecutionContext, ToolRegistration } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { newsletterAgentToolCatalog } from "../agent-tools.js";
import { createHookRegistry } from "../hooks.js";
import { InMemoryNewsletterAudienceSnapshotRepo, InMemoryNewsletterCampaignRepo, InMemoryNewsletterConfirmationTokenRepo, InMemoryNewsletterListRepo, InMemoryNewsletterSendRepo, InMemoryNewsletterSubscriptionRepo } from "../repo.memory.js";
import { buildNewsletterRegistrations, type NewsletterToolDeps } from "../tool-registrations.js";
import type { CampaignRecord, NewsletterListRow, SendRow, SubscriptionRow } from "../types.js";

export const now = "2026-11-25T00:00:00.000Z";
export const campaignRow = (id: string, over: Partial<CampaignRecord> = {}): CampaignRecord => ({
  id, workspaceId: "ws-1", status: "draft", subject: `Subject ${id}`, preheader: null, fromName: "Sender", fromEmail: "sender@example.test",
  replyTo: "reply@example.test", listId: "list-1", scheduledAt: null, sendStartedAt: null, audienceSnapshotId: "snap-internal",
  counters: { recipients: 0, delivered: 0, failed: 0, bounced: 0, complained: 0, unsubscribed: 0 },
  version: 1, createdByPrincipal: "actor-internal", createdAt: now, updatedAt: now, ...over,
});
export const listRow = (id: string, over: Partial<NewsletterListRow> = {}): NewsletterListRow => ({ id, workspaceId: "ws-1", name: `List ${id}`, slug: id, isDefault: false, status: "active", createdAt: now, updatedAt: now, ...over });
export const subscriptionRow = (id: string, over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({ id, workspaceId: "ws-1", listId: "list-1", subscriberId: `person-${id}`, status: "subscribed", source: "admin",
  consentRevisionIdAtSubscribe: "rev-internal", subscribedAt: now, unsubscribedAt: null, createdAt: now, updatedAt: now, ...over });
export const sendRow = (id: string, over: Partial<SendRow> = {}): SendRow => ({ id, workspaceId: "ws-1", campaignId: "c1", audienceSnapshotId: "snap-internal", subscriberId: `person-${id}`,
  recipientEmail: `${id}@example.test`, status: "sent", attempts: 1, idempotencyKey: `idem-${id}`, providerMessageId: `pm-${id}`, lastError: null, nextAttemptAt: null, createdAt: now, updatedAt: now, ...over });

export function newsletterHarness({ campaigns = [], lists = [], subscriptions = [], sends = [], allowed = true }: { campaigns?: CampaignRecord[]; lists?: NewsletterListRow[]; subscriptions?: SubscriptionRow[]; sends?: SendRow[]; allowed?: boolean } = {}) {
  const authorize = vi.fn<AuthorizeFn>(async () => ({ allowed, reason: allowed ? "grant" : "no grant" }));
  const notWired = (): never => { throw new Error("not wired in this harness"); };
  const deps: NewsletterToolDeps = {
    catalog: newsletterAgentToolCatalog, hostReads: { readRef: ({ entity }) => `content_read.${entity}` },
    buildConfirmationDeps: notWired, buildSubscriptionsDeps: notWired, buildSendPipelineDeps: notWired,
    authorize, workspaceId: "ws-1", clock: { nowIso: () => now }, idGen: { newId: () => "new-id" },
    outbox: { enqueue: vi.fn(), claimPending: vi.fn(), markDelivered: vi.fn(), markFailed: vi.fn() },
    bus: { publish: vi.fn(), publishBatch: vi.fn(), subscribe: vi.fn(), subscribeAll: vi.fn() },
    mailer: { capabilities: () => ({ driver: "memory", supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false }),
      send: vi.fn(), sendBatch: vi.fn() },
    originRegistry: { canonicalOrigin: async () => ({ scheme: "https", host: "example.test", verifiedAt: now, source: "workspace-setting" }), isAllowedRedirectTarget: async () => true, isAllowedEgressTarget: async () => true },
    newsletterReady: Promise.resolve(),
    newsletterCampaignRepo: new InMemoryNewsletterCampaignRepo({ campaigns }),
    newsletterListRepo: new InMemoryNewsletterListRepo({}, { initialRows: lists }),
    newsletterSubscriptionRepo: new InMemoryNewsletterSubscriptionRepo({}, { initialRows: subscriptions }),
    newsletterAudienceSnapshotRepo: new InMemoryNewsletterAudienceSnapshotRepo(),
    newsletterSendRepo: new InMemoryNewsletterSendRepo({}, { initialRows: sends }),
    newsletterConfirmationTokenRepo: new InMemoryNewsletterConfirmationTokenRepo(),
    newsletterSubscriberDirectory: { getContact: async () => null, getContacts: async () => [] },
    newsletterHooks: createHookRegistry(), membersConsentCapability: null,
  };
  return { deps, authorize };
}

export function toolOf({ registrations, id }: { registrations: readonly ToolRegistration[]; id: string }) {
  const found = registrations.find(row => row.descriptor.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

export const call = ({ deps, id, input }: { deps: NewsletterToolDeps; id: string; input: unknown }) => {
  const ctx: ToolExecutionContext = { executionId: "exec", principal: { id: "actor-1" }, run: { id: "run" }, signal: new AbortController().signal, input };
  return toolOf({ registrations: buildNewsletterRegistrations(deps), id }).handler(ctx);
};
