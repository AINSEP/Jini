import { expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { MailProviderConfiguration } from "@jini-ai/platform/mail";
import { saveMailProviderCredential } from "../provider-operations.js";
import { buildMailStatusRegistrations, type MailStatusToolDeps } from "../tool-registrations.js";
import { buildMailDeliveryRegistrations, type MailDeliveryToolCollaborators, type MailDeliveryToolDeps } from "../delivery-tool-registrations.js";

const ctx: ToolExecutionContext = { executionId: "e", principal: { id: "owner" }, run: { id: "r" }, input: {}, signal: new AbortController().signal };
const surfaces = { surfaceExchanges: {} } as AssistantSurfaceDeps;
const approvalToolHandler: MailDeliveryToolCollaborators["approvalToolHandler"] = ({ prepare, run }) => async (ctx, options = {}) => {
  const prepared = await prepare({ ctx }, options);
  return run({ ctx, prepared, confirmer: { id: ctx.principal.id, kind: "user" } }, options);
};

it("rotation carries the omitted username and attaches the saved key before invalidation", async () => {
  const calls: string[] = [];
  const provider: MailProviderConfiguration = { id: "mail", label: "Mail", origin: "plugin", hosted: true, lanes: [], capabilities: { feedback: false, domainVerification: false },
    credential: { required: true, saved: true, label: "Mail", credentialId: "key" }, selectable: true, setup: { fields: [] } };
  const update = vi.fn(async () => { calls.push("update"); return { id: "key", username: "login" }; });
  await saveMailProviderCredential({ control: { describe: async () => ({ setting: {}, providers: [provider], refusals: [] }), check: async () => ({ ok: true, label: "Mail" }),
    select: async () => {}, invalidate: () => { calls.push("invalidate"); } }, workspaceId: "w", providerId: "mail", category: "ops", input: { token: "replacement" },
    credentials: { describe: async () => ({ id: "key", username: "login" }), update, create: async () => ({ id: "key" }) } },
    { projectKeys: { savedResult: async () => { calls.push("saved"); } } });
  expect(update).toHaveBeenCalledWith({ workspaceId: "w", id: "key", connection: { token: "replacement" }, username: "login" });
  expect(calls).toEqual(["update", "saved", "invalidate"]);
});

it("test-send capture reports sent false with the existing outcome envelope", async () => {
  const result = { outcome: "captured" as const, to: "owner@example.test", from: "site@example.test", driver: "smtp", at: "now", where: "capture" as const, providerMessageId: "capture" };
  const deps = { workspaceId: "w", authorize: async () => ({ allowed: true, reason: "grant" }), mailer: {}, approvalToolHandler,
    isMailDeliveryAvailable: () => false, unavailableNote: "unavailable", readTestRecipient: () => undefined,
    planMailTestSend: async () => ({ to: result.to, driver: "smtp", capture: true, approval: { from: { email: result.from }, providerId: null } }),
    runMailTestSend: async () => result } as unknown as MailStatusToolDeps;
  const registration = buildMailStatusRegistrations(deps, surfaces).find(item => item.descriptor.id === "mail_send_test")!;
  expect(await registration.handler(ctx, {})).toEqual({ sent: false, ...result });
});

it("capture-clear rereads after approval and refuses a changed revision before clearing", async () => {
  const clear = vi.fn(async () => ({ cleared: true as const, deleted: 1 }));
  const planCaptureClear = vi.fn().mockResolvedValueOnce({ plan: { count: 1, newestAt: "before" }, revision: "before", clear })
    .mockResolvedValueOnce({ plan: { count: 2, newestAt: "after" }, revision: "after", clear });
  const deps = { workspaceId: "w", authorize: async () => ({ allowed: true, reason: "grant" }) } as MailDeliveryToolDeps;
  const registration = buildMailDeliveryRegistrations(deps, surfaces, { planCaptureClear, approvalToolHandler }).find(item => item.descriptor.id === "mail_clear_captured")!;
  await expect(registration.handler(ctx, {})).rejects.toThrow("New test emails arrived");
  expect(planCaptureClear).toHaveBeenCalledTimes(2);
  expect(clear).not.toHaveBeenCalled();
});
