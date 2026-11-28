import { describe, expect, it } from "vitest";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import { buildMailDeliveryRegistrations, contributeMailDeliveryTools, mailDeliveryDerivedRisk, type CaptureClearPlan,
  type MailDeliveryToolCollaborators, type MailDeliveryToolDeps } from "../delivery-tool-registrations.js";
import { MAIL_PERMISSION_IDS, MAIL_STATUS_PERMISSION } from "../permissions.js";

class ActivityForbidden extends Error {}
class ActivityUnavailable extends Error {}
class SuppressionsUnavailable extends Error {}

const ctx = (input: unknown): ToolExecutionContext => ({ executionId: "e", principal: { id: "owner" }, run: { id: "r" }, input, signal: new AbortController().signal });
const surfaces = { surfaceExchanges: {} } as AssistantSurfaceDeps;
const plan = { address: "a@b.example", scope: "all" as const, reason: "asked", suppressionReason: "bounced" as const, suppressedAt: "2026-01-02", revision: "r1",
  warnings: ["They may bounce again.", "Not a consent."] };

/** Strict collaborator fakes: each records its exact call and returns a distinct marker. */
function harness(options: { allowed?: boolean; found?: unknown; plans?: CaptureClearPlan[]; failList?: Error } = {}) {
  const calls: Array<[string, unknown]> = [];
  const cards: unknown[] = [];
  const asks: boolean[] = [];
  const flags: unknown[] = [];
  const authorized: unknown[] = [];
  const plans = [...(options.plans ?? [])];
  const deps = { workspaceId: "ws", ownerPrincipalId: "owner",
    authorize: async (input: unknown) => { authorized.push(input); return options.allowed === false ? { allowed: false, reason: "denied" } : { allowed: true, reason: "test" }; },
  } as unknown as MailDeliveryToolDeps;
  const record = <T>(name: string, value: T) => async (args: unknown) => { calls.push([name, args]); return value; };
  const collaborators: MailDeliveryToolCollaborators = {
    planCaptureClear: async (args) => { calls.push(["planCaptureClear", args.deps]); const next = plans.shift(); if (!next) throw new Error("no plan scripted"); return next; },
    approvalToolHandler: ({ prepare, describe, run }, optional) => async (c, opts = {}) => {
      flags.push(optional?.flag);
      const prepared = await prepare({ ctx: c }, opts);
      cards.push(await describe({ ctx: c, prepared }));
      asks.push(optional?.ask ? optional.ask({ prepared }) : true);
      return run({ ctx: c, prepared, confirmer: { id: c.principal.id, kind: "user" } }, opts);
    },
    deps: {
      getMailActivity: record("getMailActivity", options.found),
      listMailActivity: async (args) => { calls.push(["listMailActivity", args]); if (options.failList) throw options.failList; return "activity-page"; },
      listMailSuppressions: record("listMailSuppressions", "suppression-page"),
      MailActivityForbiddenError: ActivityForbidden, MailActivityUnavailableError: ActivityUnavailable, MailSuppressionsUnavailableError: SuppressionsUnavailable,
      planMailSuppressionRemoval: async (args) => { calls.push(["planMailSuppressionRemoval", args]); return plan; },
      readMailActivityId: ({ value }) => ({ idempotencyKey: `key:${String(value)}`, recipient: "r@b.example" }),
      readMailActivityQuery: ({ input }) => ({ limit: Number(input.limit), filter: {} }),
      readMailSuppressionQuery: ({ input }) => ({ limit: Number(input.limit), filter: { search: String(input.search) } }),
      readMailSuppressionRemoval: ({ input }) => ({ address: String(input.address), scope: "bulk", reason: "asked" }),
      runMailSuppressionRemoval: record("runMailSuppressionRemoval", { removed: true }),
      readMailFeedbackSetup: record("readMailFeedbackSetup", "feedback-setup"),
      mailUseReadinessDepsFrom: (host) => ({ workspaceId: `readiness:${host.workspaceId}`, mailer: host.mailer }),
      readMailUseReadiness: record("readMailUseReadiness", "readiness-report"),
    },
  };
  const regs = buildMailDeliveryRegistrations(deps, surfaces, collaborators);
  const call = (id: string, input: unknown = {}) => regs.find(r => r.descriptor.id === id)!.handler(ctx(input), {});
  const domainDeps = { workspaceId: "ws", authorize: deps.authorize, permissions: MAIL_PERMISSION_IDS, ownerPrincipalId: "owner" };
  return { deps, call, calls, cards, asks, flags, authorized, domainDeps, collaborators };
}

describe("delivery read tools", () => {
  it("readiness and feedback setup check the status permission, then read through the injected readers", async () => {
    const h = harness();
    expect(await h.call("mail_get_readiness")).toBe("readiness-report");
    expect(await h.call("mail_get_feedback_setup")).toBe("feedback-setup");
    expect(h.calls).toEqual([["readMailUseReadiness", { workspaceId: "readiness:ws", mailer: undefined }], ["readMailFeedbackSetup", h.deps]]);
    expect(h.authorized).toEqual([
      expect.objectContaining({ workspaceId: "ws", principalId: "owner", permission: MAIL_STATUS_PERMISSION }),
      expect.objectContaining({ workspaceId: "ws", principalId: "owner", permission: MAIL_STATUS_PERMISSION })]);
  });

  it("a refused grant stops readiness and feedback setup before any read, as the domain's forbidden code", async () => {
    const h = harness({ allowed: false });
    await expect(h.call("mail_get_readiness")).rejects.toThrow(/^MAIL_DELIVERY_FORBIDDEN: /);
    await expect(h.call("mail_get_feedback_setup")).rejects.toThrow(/^MAIL_DELIVERY_FORBIDDEN: /);
    await expect(h.call("mail_get_readiness", "not-a-record")).rejects.toBeInstanceOf(ToolInputError);
    expect(h.calls).toEqual([]);
  });

  it("activity and suppression lists pass the caller, the parsed query and the per-call domain deps", async () => {
    const h = harness();
    expect(await h.call("mail_list_activity", { limit: 5 })).toBe("activity-page");
    expect(await h.call("mail_list_suppressions", { limit: 7, search: "b.example" })).toBe("suppression-page");
    expect(h.calls).toEqual([
      ["listMailActivity", { principalId: "owner", query: { limit: 5, filter: {} }, deps: h.domainDeps }],
      ["listMailSuppressions", { principalId: "owner", query: { limit: 7, filter: { search: "b.example" } }, deps: h.domainDeps }]]);
  });

  it("returns a found activity and refuses an unknown id with a pointer to the list tool", async () => {
    expect(await harness({ found: { id: "row" } }).call("mail_get_activity", { activityId: "a1" })).toEqual({ id: "row" });
    const missing = harness({ found: null });
    await expect(missing.call("mail_get_activity", { activityId: "a1" })).rejects.toThrow("No email send with that id exists on this site. List them with mail_list_activity.");
    expect(missing.calls).toEqual([["getMailActivity", { principalId: "owner", activityId: { idempotencyKey: "key:a1", recipient: "r@b.example" }, deps: missing.domainDeps }]]);
  });

  it("maps each listed domain error to its model-facing code and leaves others unclassified", async () => {
    await expect(harness({ failList: new ActivityForbidden("not yours") }).call("mail_list_activity", { limit: 1 })).rejects.toThrow("MAIL_DELIVERY_FORBIDDEN: not yours");
    await expect(harness({ failList: new ActivityUnavailable("no ledger") }).call("mail_list_activity", { limit: 1 })).rejects.toThrow("MAIL_DELIVERY_UNAVAILABLE: no ledger");
    await expect(harness({ failList: new SuppressionsUnavailable("no list") }).call("mail_list_activity", { limit: 1 })).rejects.toThrow("MAIL_DELIVERY_UNAVAILABLE: no list");
    const other = new Error("db down");
    await expect(harness({ failList: other }).call("mail_list_activity", { limit: 1 })).rejects.toBe(other);
  });
});

describe("approval-gated delivery tools", () => {
  it("suppression removal plans from the parsed input, shows the blocked reason and warnings, and runs the approved plan", async () => {
    const h = harness();
    expect(await h.call("mail_remove_suppression", { address: "a@b.example" })).toEqual({ removed: true });
    expect(h.calls).toEqual([
      ["planMailSuppressionRemoval", { principalId: "owner", input: { address: "a@b.example", scope: "bulk", reason: "asked" }, deps: h.domainDeps }],
      ["runMailSuppressionRemoval", { principalId: "owner", plan, deps: h.domainDeps }]]);
    expect(h.flags).toEqual(["removed"]);
    expect(h.cards).toEqual([{ toolId: "mail_remove_suppression", errorCode: "MAIL", title: "Allow email to a@b.example again?",
      details: [{ label: "Address", value: "a@b.example" }, { label: "Scope", value: "All email" }, { label: "Blocked because", value: "bounced (2026-01-02)" },
        { label: "Your reason (recorded)", value: "asked" }], warning: "They may bounce again. Not a consent.", confirmLabel: "Remove from do-not-send list" }]);
  });

  it("names a bulk-only suppression as newsletters on the card", async () => {
    const h = harness();
    h.collaborators.deps.planMailSuppressionRemoval = async () => ({ ...plan, scope: "bulk" });
    const regs = buildMailDeliveryRegistrations(h.deps, surfaces, h.collaborators);
    await regs.find(r => r.descriptor.id === "mail_remove_suppression")!.handler(ctx({ address: "a@b.example" }), {});
    expect((h.cards[0] as { details: unknown[] }).details[1]).toEqual({ label: "Scope", value: "Newsletters (bulk mail)" });
  });

  it("capture clear: one capture reads singular, an approved unchanged plan clears, nothing is asked or deleted when empty", async () => {
    const cleared = { cleared: true as const, deleted: 1 };
    const one: CaptureClearPlan = { plan: { count: 1, newestAt: "2026-01-03" }, revision: "v1", clear: async () => cleared };
    const h = harness({ plans: [one, one] });
    expect(await h.call("mail_clear_captured")).toBe(cleared);
    const empty: CaptureClearPlan = { plan: { count: 0, newestAt: null }, revision: "v0", clear: async () => { throw new Error("must not clear"); } };
    const e = harness({ plans: [empty, empty] });
    expect(await e.call("mail_clear_captured")).toEqual({ cleared: false, empty: true });
    expect([h.asks, e.asks, h.flags]).toEqual([[true], [false], ["cleared"]]);
    expect(h.cards).toEqual([{ toolId: "mail_clear_captured", errorCode: "MAIL", title: "Delete 1 captured test email?",
      details: [{ label: "Test emails", value: "1" }, { label: "Newest", value: "2026-01-03" }],
      warning: "This cannot be undone. Sent-email records, delivery history and the do-not-send list are not touched.", confirmLabel: "Delete test emails" }]);
    expect((e.cards[0] as { title: string; details: unknown[] })).toMatchObject({ title: "Delete 0 captured test emails?", details: [{ label: "Test emails", value: "0" }, { label: "Newest", value: "-" }] });
    expect(h.calls).toEqual([["planCaptureClear", h.deps], ["planCaptureClear", h.deps]]);
  });
});

it("contributes the seven delivery tools under their own domain with the derived risk", () => {
  const h = harness();
  const contributor = contributeMailDeliveryTools(h.collaborators);
  expect(contributor.domain).toBe("system-mail-delivery");
  expect(contributor.risk).toBe(mailDeliveryDerivedRisk);
  expect(contributor.build(h.deps, surfaces).map(r => r.descriptor.id).sort()).toEqual([...mailDeliveryDerivedRisk.keys()].sort());
  expect(mailDeliveryDerivedRisk.size).toBe(7);
});
