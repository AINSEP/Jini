import { NewsletterLaunchGateBlockedError } from "@jini-ai/user-management/newsletter/errors";
import { authorizeSend } from "@jini-ai/user-management/newsletter/send-pipeline";
import { expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { buildNewsletterDeliveryRegistrations, type NewsletterDeliveryToolDeps } from "../tool-registrations.js";

const calls = vi.hoisted(() => [] as string[]);
// The unit imports the pipeline through its package specifier, so the mock must name that specifier.
vi.mock("@jini-ai/user-management/newsletter/send-pipeline", () => ({
  authorizeSend: vi.fn(async () => { calls.push("authorize-send"); return { campaign: { id: "campaign", listId: "list", status: "sending" } }; }),
  freezeAudience: vi.fn(async () => { calls.push("freeze"); }), claimBatch: vi.fn(async () => { calls.push("claim"); }),
  completeIfDrained: vi.fn(async () => { calls.push("complete"); }), resumeCampaign: vi.fn(), sendTestCampaign: vi.fn(), pauseCampaign: vi.fn(),
}));

it("launches a scheduled campaign only after the fresh transition commits, then freezes and fans out", async () => {
  calls.length = 0;
  const campaign = { id: "campaign", listId: "list", status: "scheduled", version: 1 };
  const deps = { workspaceId: "w", authorize: async () => ({ allowed: true, reason: "grant" }), newsletterReady: Promise.resolve(), mailer: { capabilities: () => ({ driver: "smtp" }) },
    newsletterCampaignRepo: { findById: async () => { calls.push("read"); return campaign; }, transaction: async ({ fn }: { fn: () => Promise<unknown> }) => { calls.push("begin"); const result = await fn(); calls.push("commit"); return result; } },
    buildSendPipelineDeps: () => ({}), approvalToolHandler: ({ prepare, run }: Parameters<NewsletterDeliveryToolDeps["approvalToolHandler"]>[0]) => async (ctx: ToolExecutionContext, options = {}) => {
      const prepared = await prepare({ ctx }, options); return run({ ctx, prepared, confirmer: { id: "owner", kind: "user" } }, options);
    } } as unknown as NewsletterDeliveryToolDeps;
  const tool = buildNewsletterDeliveryRegistrations(deps, { surfaceExchanges: {} } as AssistantSurfaceDeps).find(item => item.descriptor.id === "newsletter_send_campaign")!;
  expect(await tool.handler({ input: { campaignId: "campaign" }, executionId: "e", principal: { id: "owner" }, run: { id: "r" }, signal: new AbortController().signal })).toEqual({ confirmed: true, started: true, campaignId: "campaign", status: "sending", delivered: false, mailDeliveryAvailable: true });
  expect(calls).toEqual(["read", "begin", "read", "authorize-send", "commit", "freeze", "claim", "complete"]);
});

it("a campaign changed after the card refuses before transition or fan-out", async () => {
  calls.length = 0;
  let campaign = { id: "campaign", listId: "list", status: "scheduled", version: 1 };
  const deps = { workspaceId: "w", authorize: async () => ({ allowed: true, reason: "grant" }), newsletterReady: Promise.resolve(), mailer: { capabilities: () => ({ driver: "smtp" }) },
    newsletterCampaignRepo: { findById: async () => campaign, transaction: async ({ fn }: { fn: () => Promise<unknown> }) => fn() },
    approvalToolHandler: ({ prepare, run }: Parameters<NewsletterDeliveryToolDeps["approvalToolHandler"]>[0]) => async (ctx: ToolExecutionContext, options = {}) => {
      const prepared = await prepare({ ctx }, options); campaign = { ...campaign, version: 2 }; return run({ ctx, prepared, confirmer: { id: "owner", kind: "user" } }, options);
    } } as unknown as NewsletterDeliveryToolDeps;
  const tool = buildNewsletterDeliveryRegistrations(deps, { surfaceExchanges: {} } as AssistantSurfaceDeps).find(item => item.descriptor.id === "newsletter_send_campaign")!;
  await expect(tool.handler({ input: { campaignId: "campaign" }, executionId: "e", principal: { id: "owner" }, run: { id: "r" }, signal: new AbortController().signal })).rejects.toThrow("NEWSLETTER_STALE_CONFIRMATION");
  expect(calls).toEqual([]);
});


it("mail-off returns the unchanged refusal without a campaign read or transition", async () => {
  calls.length = 0;
  const note = "NEWSLETTER_MAIL_OFF: Email sending is not configured. Configure an SMTP credential or a mail adapter in Agent Plugins before sending newsletters. Nothing was sent or scheduled.";
  const read = vi.fn();
  const deps = { workspaceId: "w", authorize: async () => ({ allowed: true }), mailer: { capabilities: () => ({ driver: "memory" }) }, deliveryCopy: { mailOff: note }, newsletterCampaignRepo: { findById: read },
    approvalToolHandler: ({ prepare, run }: Parameters<NewsletterDeliveryToolDeps["approvalToolHandler"]>[0]) => async (ctx: ToolExecutionContext, options = {}) => {
      const prepared = await prepare({ ctx }, options); return run({ ctx, prepared, confirmer: { id: "owner", kind: "user" } }, options);
    } } as unknown as NewsletterDeliveryToolDeps;
  const tool = buildNewsletterDeliveryRegistrations(deps, { surfaceExchanges: {} as never }).find(item => item.descriptor.id === "newsletter_send_campaign")!;
  expect(await tool.handler({ input: { campaignId: "campaign" }, executionId: "e", principal: { id: "owner" }, run: { id: "r" }, signal: new AbortController().signal })).toEqual({ delivered: false, mailDeliveryAvailable: false, note });
  expect(read).not.toHaveBeenCalled(); expect(calls).toEqual([]);
});

it("a launch-gate refusal keeps its exact error and never freezes or fans out", async () => {
  calls.length = 0;
  vi.mocked(authorizeSend).mockRejectedValueOnce(new NewsletterLaunchGateBlockedError({ message: "gate", unmetPreconditions: ["sending-disabled"] }));
  const campaign = { id: "campaign", listId: "list", status: "scheduled", version: 1 };
  const deps = { workspaceId: "w", authorize: async () => ({ allowed: true }), mailer: { capabilities: () => ({ driver: "smtp" }) }, newsletterReady: Promise.resolve(),
    deliveryCopy: { launchGateBlocked: (unmet: readonly string[]) => `NEWSLETTER_LAUNCH_GATE_BLOCKED: ${unmet.join(", ")}. Enable newsletter sending and bind Members consent before launching a mass send.` },
    newsletterCampaignRepo: { findById: async () => campaign, transaction: async ({ fn }: { fn: () => Promise<unknown> }) => fn() }, buildSendPipelineDeps: () => ({}),
    approvalToolHandler: ({ prepare, run }: Parameters<NewsletterDeliveryToolDeps["approvalToolHandler"]>[0]) => async (ctx: ToolExecutionContext, options = {}) => {
      const prepared = await prepare({ ctx }, options); return run({ ctx, prepared, confirmer: { id: "owner", kind: "user" } }, options);
    } } as unknown as NewsletterDeliveryToolDeps;
  const tool = buildNewsletterDeliveryRegistrations(deps, { surfaceExchanges: {} as never }).find(item => item.descriptor.id === "newsletter_send_campaign")!;
  await expect(tool.handler({ input: { campaignId: "campaign" }, executionId: "e", principal: { id: "owner" }, run: { id: "r" }, signal: new AbortController().signal })).rejects.toThrow("NEWSLETTER_LAUNCH_GATE_BLOCKED: sending-disabled. Enable newsletter sending and bind Members consent before launching a mass send.");
  expect(calls).toEqual([]);
});
