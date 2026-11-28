import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { MailProviderConfiguration, MailStatusReport, PositionalMailer } from "@jini-ai/core/contracts/mail";
import type { MailProviderControl } from "../provider-operations.js";
import { buildMailStatusRegistrations, contributeMailStatusTools, mailStatusDerivedRisk, type MailStatusToolDeps } from "../tool-registrations.js";

const ctx = (input: unknown): ToolExecutionContext => ({ executionId: "exec-1", principal: { id: "owner" }, run: { id: "r" }, input, signal: new AbortController().signal });
const surfaces = { surfaceExchanges: {} } as AssistantSurfaceDeps;
const mailer: PositionalMailer = {
  capabilities: () => ({ driver: "smtp", supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1 }) as ReturnType<PositionalMailer["capabilities"]>,
  send: async () => { throw new Error("no sends in status tool tests"); }, sendBatch: async () => [],
};
type Plan = Awaited<ReturnType<MailStatusToolDeps["planMailTestSend"]>>;
type Result = Awaited<ReturnType<MailStatusToolDeps["runMailTestSend"]>>;
const basePlan: Plan = { to: "me@site.example", chosen: false, driver: "smtp", approval: { from: { email: "site@site.example" }, providerId: "pm", driver: "smtp", mode: "off", effectiveRecipient: "me@site.example" } };
const common = { to: "me@site.example", from: "site@site.example", driver: "smtp", at: "now" };

/** Grants are scripted per check (true = allowed); every check and every port call is recorded. */
function harness(overrides: Partial<MailStatusToolDeps> = {}, grants: boolean[] = []) {
  const checks: unknown[] = [];
  const cards: unknown[] = [];
  const calls: Array<[string, unknown]> = [];
  const deps: MailStatusToolDeps = {
    workspaceId: "ws", mailer, unavailableNote: "Email is not set up.",
    authorize: async (input) => { checks.push(input); return grants.length && !grants.shift() ? { allowed: false, reason: "denied" } : { allowed: true, reason: "test" }; },
    isMailDeliveryAvailable: (candidate) => { calls.push(["available", candidate === mailer]); return true; },
    approvalToolHandler: ({ prepare, describe, run }) => async (c, opts = {}) => {
      const prepared = await prepare({ ctx: c }, opts);
      cards.push(await describe({ ctx: c, prepared }));
      return run({ ctx: c, prepared, confirmer: { id: c.principal.id, kind: "user" } }, opts);
    },
    readTestRecipient: ({ value }) => (typeof value === "string" ? value : undefined),
    planMailTestSend: async (required) => { calls.push(["plan", { principalId: required.principalId, to: required.to }]); return basePlan; },
    runMailTestSend: async (required) => { calls.push(["run", { principalId: required.principalId, ref: required.ref, to: required.plan.to }]); return { ...common, outcome: "accepted", providerMessageId: "m1" }; },
    ...overrides,
  };
  const regs = buildMailStatusRegistrations(deps, surfaces);
  const call = (id: string, input: unknown = {}) => regs.find(r => r.descriptor.id === id)!.handler(ctx(input), {});
  return { deps, call, checks, cards, calls };
}

function control(extra: Partial<MailProviderControl> = {}): MailProviderControl & { selected: unknown[]; invalidated: number } {
  const state = { selected: [] as unknown[], invalidated: 0 };
  return Object.assign(state, {
    check: async ({ id }: { id: string }) => (id === "pm" ? { ok: true as const, label: "Postmark" } : { ok: false as const, reason: `${id} (no saved key)` }),
    select: async (input: unknown) => { state.selected.push(input); },
    readSelection: async () => ({ setting: { transactional: "smtp", bulk: "ses" }, revisionSeq: 4 }),
    invalidate: () => { state.invalidated += 1; },
    ...extra,
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe("system_get_mail_status", () => {
  it("reports configured delivery with a refreshed status report", async () => {
    const reads: unknown[] = [];
    const report = { lanes: [], warnings: ["sender_unknown"] } as unknown as MailStatusReport;
    const h = harness({ mailStatus: async (optional) => { reads.push(optional); return report; } });
    expect(await h.call("system_get_mail_status", { refresh: true })).toEqual({ mailDeliveryAvailable: true, driver: "smtp", note: "Email sending is configured.", lanes: [], warnings: ["sender_unknown"] });
    await h.call("system_get_mail_status", { refresh: "yes" });
    expect(reads).toEqual([{ refresh: true }, { refresh: false }]);
    expect(h.checks).toEqual([expect.objectContaining({ principalId: "owner", permission: "admin.forms.manage" }), expect.objectContaining({ permission: "admin.forms.manage" })]);
  });

  it("uses the host's unavailable note without a status seam, and refuses a denied caller before reading the mailer", async () => {
    const h = harness({ isMailDeliveryAvailable: () => false });
    expect(await h.call("system_get_mail_status")).toEqual({ mailDeliveryAvailable: false, driver: "smtp", note: "Email is not set up." });
    const denied = harness({}, [false]);
    await expect(denied.call("system_get_mail_status")).rejects.toThrow(/^MAIL_STATUS_FORBIDDEN: /);
    expect(denied.calls).toEqual([]);
  });
});

describe("mail_set_provider", () => {
  it("freezes the provider and revision on the access card, then selects with that revision and drops caches", async () => {
    const c = control();
    const h = harness({ mailProviderControl: c });
    expect(await h.call("mail_set_provider", { providerId: " pm " })).toEqual({ set: true, providerId: "pm" });
    expect(c.selected).toEqual([{ id: "pm", principalId: "owner", expectedRevisionSeq: 4 }]);
    expect(c.invalidated).toBe(1);
    expect(h.cards).toEqual([expect.objectContaining({ toolId: "mail_set_provider", title: "Send this site's email through Postmark?", confirmLabel: "Switch provider",
      access: { resources: [{ id: "core.mail.provider", label: "Mail provider", scope: { personId: "owner", siteId: "ws" }, previous: { transactional: "smtp", bulk: "ses" },
        proposed: { transactional: "pm", bulk: "pm" }, revision: "4" }] },
      details: [{ label: "Provider", value: "Postmark (pm)" }, { label: "Applies to", value: "Transactional and bulk mail" },
        { label: "Currently", value: "Transactional: smtp; bulk: ses. Both lanes will use the new provider." }] })]);
    expect(h.checks).toEqual([expect.objectContaining({ permission: "settings.workspace.write" }), expect.objectContaining({ permission: "settings.workspace.write" })]);
  });

  it("refuses a blank id, a root without selection, a refused provider or a missing snapshot, changing nothing", async () => {
    const c = control();
    await expect(harness({ mailProviderControl: c }).call("mail_set_provider", { providerId: "  " })).rejects.toThrow("providerId must be an installed provider id from system_get_mail_status.");
    await expect(harness({ mailProviderControl: c }).call("mail_set_provider", { providerId: 7 })).rejects.toThrow("providerId must be an installed provider id");
    await expect(harness().call("mail_set_provider", { providerId: "pm" })).rejects.toThrow("Mail provider selection is unavailable on this server. Nothing was changed.");
    await expect(harness({ mailProviderControl: c }).call("mail_set_provider", { providerId: "ses" })).rejects.toThrow("Cannot switch to ses (no saved key). Nothing was changed.");
    const { readSelection: _snapshot, ...noSnapshot } = control();
    await expect(harness({ mailProviderControl: noSnapshot }).call("mail_set_provider", { providerId: "pm" })).rejects.toThrow("Mail provider selection snapshot is unavailable on this server.");
    expect(c.selected).toEqual([]);
  });

  it("rechecks the grant at the write: a grant revoked while the card was open selects nothing", async () => {
    const c = control();
    const h = harness({ mailProviderControl: c }, [true, false]);
    await expect(h.call("mail_set_provider", { providerId: "pm" })).rejects.toThrow(/^MAIL_STATUS_FORBIDDEN: /);
    expect(h.cards).toHaveLength(1);
    expect(c.selected).toEqual([]);
  });
});

describe("mail_send_test", () => {
  it("plans for the chosen recipient, labels the provider from the catalog and reports an accepted send as sent", async () => {
    const pm: MailProviderConfiguration = { id: "pm", label: "Postmark", origin: "plugin", hosted: true, lanes: [], capabilities: { feedback: false, domainVerification: false },
      credential: { required: true, saved: true, label: "pm-key" }, selectable: true, setup: { fields: [] } };
    const h = harness({ mailProviderControl: control({ describe: async () => ({ setting: { transactional: "pm", bulk: "pm" }, refusals: [], providers: [pm] }) }) });
    expect(await h.call("mail_send_test", { to: "you@b.example" })).toEqual({ sent: true, ...common, outcome: "accepted", providerMessageId: "m1" });
    expect(h.calls).toEqual([["plan", { principalId: "owner", to: "you@b.example" }], ["run", { principalId: "owner", ref: "exec-1", to: "me@site.example" }]]);
    expect(h.cards).toEqual([{ toolId: "mail_send_test", errorCode: "MAIL", title: "Send a test email to me@site.example?", confirmLabel: "Send test email",
      details: [{ label: "From", value: "site@site.example" }, { label: "To", value: "me@site.example" }, { label: "Through", value: "Postmark" }] }]);
  });

  it("falls back to the driver name when the catalog is absent, has no match or cannot be read, logging the read failure", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const through = async (overrides: Partial<MailStatusToolDeps>) => {
      const h = harness(overrides);
      await h.call("mail_send_test");
      return (h.cards[0] as { details: Array<{ label: string; value: string }> }).details.find(d => d.label === "Through")?.value;
    };
    expect(await through({})).toBe("smtp");
    expect(await through({ mailProviderControl: control({ describe: async () => ({ setting: { transactional: null, bulk: null }, refusals: [], providers: [] }) }) })).toBe("smtp");
    expect(logged).not.toHaveBeenCalled();
    expect(await through({ mailProviderControl: control({ describe: async () => { throw new Error("catalog down"); } }) })).toBe("smtp");
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0]?.[0]).toBe("[mail] Could not read the provider catalog");
  });

  it("omits an unchosen recipient from the plan and names test-mode redirect or capture on the card", async () => {
    const card = async (plan: Plan, result: Result) => {
      const h = harness({ planMailTestSend: async (required) => { expect("to" in required).toBe(false); return plan; }, runMailTestSend: async () => result });
      const outcome = await h.call("mail_send_test", { to: 5 }) as { sent: boolean };
      return [outcome.sent, (h.cards[0] as { details: unknown[] }).details.slice(3)];
    };
    expect(await card({ ...basePlan, redirectTo: "inbox@test.example" }, { ...common, outcome: "redirected", redirectedTo: "inbox@test.example", providerMessageId: "m2" }))
      .toEqual([true, [{ label: "Test mode", value: "Redirected to inbox@test.example" }]]);
    expect(await card({ ...basePlan, capture: true }, { ...common, outcome: "captured", where: "capture", providerMessageId: "c1" }))
      .toEqual([false, [{ label: "Test mode", value: "Captured on this server; nothing is sent" }]]);
    expect(await card({ ...basePlan, capture: false }, { ...common, outcome: "failed", errorCode: "E", message: "refused", retryable: false }))
      .toEqual([false, []]);
  });
});

it("contributes the three status tools under the system-mail domain", () => {
  const contributor = contributeMailStatusTools();
  expect([contributor.domain, contributor.risk, contributor.build]).toEqual(["system-mail", mailStatusDerivedRisk, buildMailStatusRegistrations]);
  expect(contributor.build(harness().deps, surfaces).map(r => r.descriptor.id).sort()).toEqual(["mail_send_test", "mail_set_provider", "system_get_mail_status"]);
});
