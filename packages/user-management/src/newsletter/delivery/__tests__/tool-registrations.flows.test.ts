import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";
import { claimBatch, completeIfDrained, freezeAudience, resumeCampaign, sendTestCampaign } from "@jini-ai/user-management/newsletter/send-pipeline";
import { InMemoryNewsletterCampaignRepo, InMemoryNewsletterListRepo } from "../../repo.memory.js";
import type { CampaignRecord, CampaignStatus } from "../../types.js";
import {
  buildNewsletterDeliveryRegistrations,
  contributeNewsletterDeliveryTools,
  newsletterDeliveryDerivedRisk,
  type NewsletterDeliveryToolDeps,
} from "../tool-registrations.js";

// The unit imports the pipeline through its package specifier, so the mock names that specifier.
// Only the fan-out pipeline is replaced; scheduling, the launch gate and the handlers run for real.
vi.mock("@jini-ai/user-management/newsletter/send-pipeline", () => ({
  authorizeSend: vi.fn(async () => ({ campaign: { id: "camp", listId: "list", status: "sending" } })),
  resumeCampaign: vi.fn(async () => ({ campaign: { id: "camp", listId: "list", status: "sending" }, requeueFailed: false })),
  freezeAudience: vi.fn(async () => undefined), claimBatch: vi.fn(async () => undefined), completeIfDrained: vi.fn(async () => undefined),
  sendTestCampaign: vi.fn(async () => ({ results: [{ outcome: "sent" }] })), pauseCampaign: vi.fn(),
}));

const at = "2026-06-01T08:00:00.000Z";
const copy = {
  mailOff: "copy-mail-off", processingAttention: "copy-attention", scheduled: "copy-scheduled", ownerOnly: "copy-owner-only",
  ownerEmailMissing: "copy-owner-email-missing", testNotAccepted: "copy-test-not-accepted",
  launchGateBlocked: (unmet: readonly string[]) => `copy-gate-blocked: ${unmet.join(", ")}`,
};

function campaign(status: CampaignStatus): CampaignRecord {
  return { id: "camp", workspaceId: "w", status, subject: "Spring issue", preheader: null, fromName: "Desk", fromEmail: "desk@example.test",
    replyTo: "desk@example.test", listId: "list", scheduledAt: null, sendStartedAt: null, audienceSnapshotId: null,
    counters: { recipients: 0, delivered: 0, failed: 0, bounced: 0, complained: 0, unsubscribed: 0 }, version: 1, createdByPrincipal: "owner", createdAt: at, updatedAt: at };
}

interface Options {
  status?: CampaignStatus; drivers?: string[]; sendingEnabled?: boolean; decline?: "declined" | "expired";
  ownerEmail?: string | null; onCapabilities?: (call: number) => void; onSendingEnabled?: () => void;
}

function setup(options: Options = {}) {
  const campaignRepo = new InMemoryNewsletterCampaignRepo({ campaigns: options.status ? [campaign(options.status)] : [] });
  const listRepo = new InMemoryNewsletterListRepo({}, { initialRows: [{ id: "list", workspaceId: "w", name: "Main", slug: "main", isDefault: true, status: "active", createdAt: at, updatedAt: at }] });
  const permissions: unknown[] = [];
  const cards: { asked: boolean; spec: HumanConfirmSpec }[] = [];
  const failures: [string, string][] = [];
  let capabilityCalls = 0;
  const drivers = options.drivers ?? ["smtp"];
  const mailer = { capabilities: () => {
    const driver = drivers[Math.min(capabilityCalls, drivers.length - 1)];
    capabilityCalls += 1; options.onCapabilities?.(capabilityCalls);
    return { driver, supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1, supportsAttachments: false };
  } };
  const launchGateDeps = {
    isSendingEnabled: async () => { options.onSendingEnabled?.(); return options.sendingEnabled ?? true; },
    consentCapability: {}, mailer,
    originRegistry: { canonicalOrigin: async () => ({ scheme: "https", host: "example.test" }) },
    orFallback: async ({ work, fallback }: { work: () => Promise<boolean>; fallback: boolean }) => work().catch(() => fallback),
  };
  const deps = {
    workspaceId: "w", deliveryCopy: copy, newsletterReady: Promise.resolve(), mailer, clock: { nowIso: () => at }, idGen: { newId: () => "rev-id" },
    newsletterCampaignRepo: campaignRepo, newsletterListRepo: listRepo,
    authorize: async (...args: unknown[]) => { permissions.push(args); return { allowed: true, reason: "grant" }; },
    buildSendPipelineDeps: () => ({ launchGateDeps }),
    reportDeliveryFailure: (message: string, diagnostic: string) => { failures.push([message, diagnostic]); },
    ownerPrincipalId: Promise.resolve("owner"),
    userRepo: { findByPrincipalId: async () => (options.ownerEmail === null ? null : { email: options.ownerEmail ?? "owner@example.test" }) },
    approvalToolHandler: ({ prepare, describe, run }: Parameters<NewsletterDeliveryToolDeps["approvalToolHandler"]>[0],
      optional: Parameters<NewsletterDeliveryToolDeps["approvalToolHandler"]>[1] = {}) => async (ctx: ToolExecutionContext, opts = {}) => {
      const prepared = await prepare({ ctx }, opts);
      cards.push({ asked: optional.ask?.({ prepared }) ?? true, spec: await describe({ ctx, prepared }) });
      if (options.decline) return optional.declined?.({ reason: options.decline, prepared });
      return run({ ctx, prepared, confirmer: { id: "owner", kind: "user" } }, opts);
    },
  } as unknown as NewsletterDeliveryToolDeps;
  const surfaces = { surfaceExchanges: {} } as unknown as AssistantSurfaceDeps;
  const tool = (id: string) => {
    const found = buildNewsletterDeliveryRegistrations(deps, surfaces).find(item => item.descriptor.id === id);
    if (!found) throw new Error(`tool ${id} is not registered`);
    return found;
  };
  return { tool, campaignRepo, permissions, cards, failures };
}

function ctx(input: Record<string, unknown>, signal: AbortSignal = new AbortController().signal): ToolExecutionContext {
  return { executionId: "exec", principal: { id: "owner" }, run: { id: "run" }, input, signal };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("newsletter_send_test", () => {
  it("sends only to the stored owner email and reports delivery", async () => {
    const h = setup();
    expect(await h.tool("newsletter_send_test").handler(ctx({ campaignId: "camp" }))).toEqual({ delivered: true, mailDeliveryAvailable: true });
    expect(vi.mocked(sendTestCampaign).mock.calls[0]?.[0].input).toEqual({ workspaceId: "w", campaignId: "camp", testAddresses: ["owner@example.test"] });
    expect(JSON.stringify(h.permissions)).toContain("admin.newsletter.campaign.send_test");
  });

  it("refuses any recipient input other than campaignId", async () => {
    const h = setup();
    await expect(h.tool("newsletter_send_test").handler(ctx({ campaignId: "camp", to: "x@example.test" }))).rejects.toThrow("copy-owner-only");
    expect(sendTestCampaign).not.toHaveBeenCalled();
  });

  it("returns the mail-off refusal for a non-delivering mailer", async () => {
    const h = setup({ drivers: ["console"] });
    expect(await h.tool("newsletter_send_test").handler(ctx({ campaignId: "camp" }))).toEqual({ delivered: false, mailDeliveryAvailable: false, note: "copy-mail-off" });
    expect(sendTestCampaign).not.toHaveBeenCalled();
  });

  it("refuses when the owner has no stored email, blank or missing", async () => {
    for (const ownerEmail of ["   ", null]) {
      const h = setup({ ownerEmail });
      await expect(h.tool("newsletter_send_test").handler(ctx({ campaignId: "camp" }))).rejects.toThrow("copy-owner-email-missing");
    }
    expect(sendTestCampaign).not.toHaveBeenCalled();
  });

  it("does not send for a cancelled run, and reports a refused test send as not accepted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("run cancelled"));
    await expect(setup().tool("newsletter_send_test").handler(ctx({ campaignId: "camp" }, controller.signal))).rejects.toThrow("run cancelled");
    expect(sendTestCampaign).not.toHaveBeenCalled();
    vi.mocked(sendTestCampaign).mockResolvedValueOnce({ results: [{ outcome: "failed" }] } as Awaited<ReturnType<typeof sendTestCampaign>>);
    expect(await setup().tool("newsletter_send_test").handler(ctx({ campaignId: "camp" }))).toEqual({ delivered: false, mailDeliveryAvailable: true, note: "copy-test-not-accepted" });
  });
});

describe("confirmation card", () => {
  it("describes each tool with its own title and the campaign details", async () => {
    const send = setup({ status: "draft" });
    await send.tool("newsletter_send_campaign").handler(ctx({ campaignId: "camp" }));
    expect(send.cards[0]).toEqual({ asked: true, spec: { toolId: "newsletter_send_campaign", errorCode: "NEWSLETTER", title: "Send this newsletter?",
      description: "This action can send email to real people. Only your confirmation can authorize it.", confirmLabel: "Confirm",
      details: [{ label: "Subject", value: "Spring issue" }, { label: "Campaign", value: "camp" }, { label: "Subscriber list", value: "list" }, { label: "Status", value: "draft" }] } });
    const schedule = setup({ status: "draft" });
    await schedule.tool("newsletter_schedule_campaign").handler(ctx({ campaignId: "camp", scheduledAt: "2026-07-01T09:00:00Z" }));
    expect(schedule.cards[0]?.spec.title).toBe("Schedule this newsletter?");
    expect(schedule.cards[0]?.spec.details?.at(-1)).toEqual({ label: "Scheduled date", value: "2026-07-01T09:00:00Z" });
    const resume = setup({ status: "paused" });
    await resume.tool("newsletter_resume_campaign").handler(ctx({ campaignId: "camp" }));
    expect(resume.cards[0]?.spec.title).toBe("Resume this newsletter?");
  });

  it("a mail-off refusal is not asked, carries no details and is returned without a campaign read", async () => {
    const h = setup({ drivers: ["memory"] });
    expect(await h.tool("newsletter_send_campaign").handler(ctx({ campaignId: "missing" }))).toEqual({ delivered: false, mailDeliveryAvailable: false, note: "copy-mail-off" });
    expect(h.cards).toEqual([{ asked: false, spec: expect.objectContaining({ details: [] }) }]);
  });

  it("a declined or expired card returns the reason and transitions nothing", async () => {
    const h = setup({ status: "draft", decline: "expired" });
    expect(await h.tool("newsletter_send_campaign").handler(ctx({ campaignId: "camp" }))).toEqual({ confirmed: false, reason: "expired", delivered: false, mailDeliveryAvailable: true });
    expect((await h.campaignRepo.findById({ workspaceId: "w", id: "camp" }))?.status).toBe("draft");
  });

  it("refuses an unknown campaign before any card", async () => {
    const h = setup();
    await expect(h.tool("newsletter_send_campaign").handler(ctx({ campaignId: "ghost" }))).rejects.toThrow("campaign ghost was not found");
    expect(h.cards).toEqual([]);
  });
});

describe("newsletter_schedule_campaign", () => {
  it("schedules the draft under the schedule permission and returns the scheduled note", async () => {
    const h = setup({ status: "draft" });
    expect(await h.tool("newsletter_schedule_campaign").handler(ctx({ campaignId: "camp", scheduledAt: "2026-07-01T09:00:00Z" }))).toEqual({
      confirmed: true, scheduled: true, campaignId: "camp", status: "scheduled", scheduledAt: "2026-07-01T09:00:00Z", delivered: false, mailDeliveryAvailable: true, note: "copy-scheduled" });
    expect((await h.campaignRepo.findById({ workspaceId: "w", id: "camp" }))?.status).toBe("scheduled");
    expect(JSON.stringify(h.permissions)).toContain("admin.newsletter.campaign.schedule");
    expect(freezeAudience).not.toHaveBeenCalled();
  });

  it("refuses a scheduledAt without an explicit timezone before any card", async () => {
    const h = setup({ status: "draft" });
    await expect(h.tool("newsletter_schedule_campaign").handler(ctx({ campaignId: "camp", scheduledAt: "2026-07-01T09:00:00" })))
      .rejects.toThrow("scheduledAt must be a valid ISO date-time string with an explicit timezone");
    expect(h.cards).toEqual([]);
  });
});

describe("newsletter_resume_campaign", () => {
  it("refuses with the gate copy naming every unmet precondition and resumes nothing", async () => {
    const h = setup({ status: "paused", sendingEnabled: false });
    await expect(h.tool("newsletter_resume_campaign").handler(ctx({ campaignId: "camp" }))).rejects.toThrow("copy-gate-blocked: sending_enabled_false");
    expect(resumeCampaign).not.toHaveBeenCalled();
  });

  it("resumes, then freezes, claims and completes for the resumed campaign", async () => {
    const h = setup({ status: "paused" });
    expect(await h.tool("newsletter_resume_campaign").handler(ctx({ campaignId: "camp" }))).toEqual({ confirmed: true, started: true, campaignId: "camp", status: "sending", delivered: false, mailDeliveryAvailable: true });
    expect(vi.mocked(resumeCampaign).mock.calls[0]?.[0].input).toEqual({ workspaceId: "w", campaignId: "camp" });
    expect(vi.mocked(freezeAudience).mock.calls[0]?.[0].input).toEqual({ workspaceId: "w", campaignId: "camp", listId: "list" });
    expect(claimBatch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(completeIfDrained).mock.calls[0]?.[0].input).toEqual({ workspaceId: "w", campaignId: "camp" });
  });

  it("a failed requeue reports processing attention without fanning out", async () => {
    vi.mocked(resumeCampaign).mockResolvedValueOnce({ campaign: campaign("sending"), requeueFailed: true } as Awaited<ReturnType<typeof resumeCampaign>>);
    const h = setup({ status: "paused" });
    expect(await h.tool("newsletter_resume_campaign").handler(ctx({ campaignId: "camp" }))).toEqual({ confirmed: true, started: true, campaignId: "camp", status: "sending", delivered: false, mailDeliveryAvailable: true, note: "copy-attention" });
    expect(freezeAudience).not.toHaveBeenCalled();
  });

  it("a run cancelled while the gate is evaluated is abandoned before resuming", async () => {
    const controller = new AbortController();
    const h = setup({ status: "paused", onSendingEnabled: () => controller.abort() });
    expect(await h.tool("newsletter_resume_campaign").handler(ctx({ campaignId: "camp" }, controller.signal))).toEqual({ confirmed: false, reason: "abandoned", delivered: false, mailDeliveryAvailable: true });
    expect(resumeCampaign).not.toHaveBeenCalled();
  });
});

describe("newsletter_send_campaign run", () => {
  it("a fan-out failure after launch is reported to the host and returned as processing attention", async () => {
    vi.mocked(freezeAudience).mockRejectedValueOnce(new Error("snapshot write failed"));
    const h = setup({ status: "draft" });
    expect(await h.tool("newsletter_send_campaign").handler(ctx({ campaignId: "camp" }))).toEqual({ confirmed: true, started: true, campaignId: "camp", status: "sending", delivered: false, mailDeliveryAvailable: true, note: "copy-attention" });
    expect(h.failures).toHaveLength(1);
    expect(h.failures[0]?.[0]).toBe("[newsletter] delivery fan-out failed after launch; inspect the send log before retrying");
    // The diagnostic names the error kind only; the raw message never reaches the host log.
    expect(h.failures[0]?.[1]).toBe("Error");
    expect(claimBatch).not.toHaveBeenCalled();
  });

  it("is abandoned when the run is cancelled after confirmation", async () => {
    const controller = new AbortController();
    const h = setup({ status: "draft", onCapabilities: call => { if (call === 1) controller.abort(); } });
    expect(await h.tool("newsletter_send_campaign").handler(ctx({ campaignId: "camp" }, controller.signal))).toEqual({ confirmed: false, reason: "abandoned", delivered: false, mailDeliveryAvailable: true });
    expect(freezeAudience).not.toHaveBeenCalled();
  });

  it("is abandoned inside the transition when the run is cancelled after the pre-checks", async () => {
    const controller = new AbortController();
    const h = setup({ status: "draft", onCapabilities: call => { if (call === 2) controller.abort(); } });
    expect(await h.tool("newsletter_send_campaign").handler(ctx({ campaignId: "camp" }, controller.signal))).toEqual({ confirmed: false, reason: "abandoned", delivered: false, mailDeliveryAvailable: true });
    expect(freezeAudience).not.toHaveBeenCalled();
  });

  it("returns the mail-off refusal when mail is switched off while the card was open", async () => {
    const h = setup({ status: "draft", drivers: ["smtp", "console"] });
    expect(await h.tool("newsletter_send_campaign").handler(ctx({ campaignId: "camp" }))).toEqual({ delivered: false, mailDeliveryAvailable: false, note: "copy-mail-off" });
    expect(freezeAudience).not.toHaveBeenCalled();
  });
});

it("contributes delivery under its own domain key with the same builder and risk map", () => {
  expect(contributeNewsletterDeliveryTools()).toEqual({ domain: "newsletter-delivery", build: buildNewsletterDeliveryRegistrations, risk: newsletterDeliveryDerivedRisk });
});
