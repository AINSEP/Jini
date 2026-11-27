import { describe, expect, it, vi } from "vitest";
import { ToolInputError, type ToolExecutionContext } from "@jini-ai/core";
import { SettingsRevisionConflictError } from "@jini-ai/core/settings";
import type { PluginCredentialCard } from "@jini-ai/core/contracts/credentials";
import type { MailProviderConfiguration, MailProviderConfigurationReport } from "@jini-ai/core/contracts/mail";
import { activateMailProvider, MailProviderOperationError, planMailProviderCredential, saveMailProviderCredential, type MailProviderControl } from "../provider-operations.js";
import { asToolInputError, buildMailProviderRegistrations, contributeMailProviderTools, currentLanesDetail, readCurrentLanes, mailProviderDerivedRisk, type MailProviderToolDeps } from "../provider-tool-registrations.js";
import { mailProviderAgentToolCatalog } from "../provider-agent-tools.js";

function provider(id: string, overrides: Partial<MailProviderConfiguration> = {}): MailProviderConfiguration {
  return { id, label: id.toUpperCase(), origin: "plugin", hosted: true, lanes: [], capabilities: { feedback: false, domainVerification: false },
    credential: { required: true, saved: false, label: `${id}-key` }, selectable: true, setup: { fields: [] }, ...overrides };
}
function control(providers: MailProviderConfiguration[], extra: Partial<MailProviderControl> = {}): MailProviderControl {
  const report: MailProviderConfigurationReport = { setting: { transactional: "smtp", bulk: "smtp" }, providers, refusals: [] };
  return { describe: async () => report, check: async ({ id }) => ({ ok: true, label: id }), select: async () => {}, ...extra };
}
const ctx = (input: unknown): ToolExecutionContext => ({ executionId: "e", principal: { id: "owner" }, run: { id: "r" }, input, signal: new AbortController().signal });
const card = (providerId: string, label: string): PluginCredentialCard => ({ providerId, label, category: "mail", baseUrl: "https://mail.example.test", title: "Key" });

function tools(deps: Partial<MailProviderToolDeps> = {}) {
  const issued: unknown[] = [];
  const all: MailProviderToolDeps = { authorize: async () => ({ allowed: true }), workspaceId: "ws", category: "mail-cat",
    loadPluginCredentialCardsSafely: async () => [], issueCredentialSetup: (required) => { issued.push(required); return { setupToolId: required.setupToolId, prefill: required.prefill }; }, ...deps };
  const regs = buildMailProviderRegistrations(all);
  const call = (id: string, input: unknown) => regs.find((r) => r.descriptor.id === id)!.handler(ctx(input));
  return { call, issued };
}

describe("mail_list_providers", () => {
  it("returns the report and, with an inventory, only outbound-mail plugins", async () => {
    const smtp = provider("smtp");
    const { call } = tools({ mailProviderControl: control([smtp]), loadAgentPluginSearchCandidates: async ({ workspaceId }) => [
      { pluginId: `mailer-${workspaceId}`, description: "Mailer", enabled: false, mcpServerIds: ["m1"], provides: ["outbound-mail"] },
      { pluginId: "cms", description: "Other", enabled: true, mcpServerIds: [], provides: ["pages"] }] });
    expect(await call("mail_list_providers", {})).toEqual({ setting: { transactional: "smtp", bulk: "smtp" }, providers: [smtp], refusals: [],
      availablePlugins: [{ pluginId: "mailer-ws", description: "Mailer", enabled: false, mcpServers: ["m1"] }] });
  });

  it("returns the bare report without an inventory, and refuses a root with no control", async () => {
    expect(await tools({ mailProviderControl: control([]) }).call("mail_list_providers", {})).toEqual({ setting: { transactional: "smtp", bulk: "smtp" }, providers: [], refusals: [] });
    await expect(tools().call("mail_list_providers", {})).rejects.toThrow("Mail provider configuration is unavailable on this server. Nothing was changed.");
  });
});

describe("mail_configure_provider", () => {
  it("creates a key setup with label, category and the provider's default base URL, naming a username follow-up", async () => {
    const smtp = provider("smtp", { setup: { fields: [{ key: "baseUrl", label: "Host", type: "text", required: false, defaultValue: "smtp.example.test" }, { key: "username", label: "User", type: "text", required: true }] } });
    const { call, issued } = tools({ mailProviderControl: control([smtp]) });
    const result = await call("mail_configure_provider", { providerId: " smtp " });
    expect(issued).toEqual([{ setupToolId: "credential_save", prefill: { kind: "api", label: "smtp-key", category: "mail-cat", baseUrl: "smtp.example.test" } }]);
    expect(result).toMatchObject({ activated: false, credential: { action: "create", label: "smtp-key", category: "mail-cat", baseUrl: "smtp.example.test" },
      followUps: [{ tool: "custom_credential_set_username", args: { label: "smtp-key" } }] });
  });

  it("targets the plugin's own credential card when one matches, without base URL or follow-ups", async () => {
    const { call, issued } = tools({ mailProviderControl: control([provider("pm")]), loadPluginCredentialCardsSafely: async () => [card("pm", "other"), card("pm", "pm-key")] });
    expect(await call("mail_configure_provider", { providerId: "pm" })).toMatchObject({ followUps: [] });
    expect(issued).toEqual([{ setupToolId: "credential_save", prefill: { kind: "plugin-provider", target: "pm" } }]);
  });

  it("a create prefill omits the base URL when the provider has none, and a non-string id is refused", async () => {
    const { call, issued } = tools({ mailProviderControl: control([provider("pm")]) });
    expect(await call("mail_configure_provider", { providerId: "pm" })).toMatchObject({ followUps: [] });
    expect(issued).toEqual([{ setupToolId: "credential_save", prefill: { kind: "api", label: "pm-key", category: "mail-cat" } }]);
    await expect(call("mail_configure_provider", { providerId: 5 })).rejects.toThrow("providerId must be an installed provider id from mail_list_providers.");
  });

  it("reuses a saved key: a note naming the rotate target and no setup card", async () => {
    const { call, issued } = tools({ mailProviderControl: control([provider("pm", { credential: { required: true, saved: true, label: "pm-key", credentialId: "c1" } })]) });
    const result = await call("mail_configure_provider", { providerId: "pm" });
    expect(result).toMatchObject({ activated: false, credential: { action: "rotate", credentialId: "c1" }, followUps: [],
      note: 'A key is already saved. Reuse it. Only if the person explicitly asks to replace it, call credential_save {kind:"api",target:"pm-key"}.' });
    expect(result).not.toHaveProperty("credentialSetup");
    expect(issued).toEqual([]);
  });

  it("refuses a blank id, an unknown provider and a keyless one as input errors", async () => {
    const { call } = tools({ mailProviderControl: control([provider("smtp"), provider("console", { credential: { required: false, saved: false } })]) });
    await expect(call("mail_configure_provider", { providerId: "  " })).rejects.toThrow("providerId must be an installed provider id from mail_list_providers.");
    await expect(call("mail_configure_provider", { providerId: "ghost" })).rejects.toThrow("'ghost' is not an installed mail provider (installed: smtp, console).");
    await expect(call("mail_configure_provider", { providerId: "console" })).rejects.toThrow("'console' needs no saved key; it can be selected directly.");
  });
});

it("asToolInputError turns only an operation refusal into an input error", async () => {
  const refused = asToolInputError({ run: async () => { throw new MailProviderOperationError({ code: "MAIL_PROVIDER_REFUSED", message: "no" }); } });
  await expect(refused).rejects.toBeInstanceOf(ToolInputError);
  await expect(asToolInputError({ run: async () => { throw new MailProviderOperationError({ code: "MAIL_PROVIDER_INPUT", message: "bad token" }); } })).rejects.toThrow("bad token");
  const boom = new Error("db down");
  await expect(asToolInputError({ run: async () => { throw boom; } })).rejects.toBe(boom);
  expect(await asToolInputError({ run: async () => 7 })).toBe(7);
});

describe("lanes helpers", () => {
  it("reads lanes only when describe exists and hides a describe fault", async () => {
    expect(await readCurrentLanes({ control: { check: async () => ({ ok: true, label: "x" }), select: async () => {} } })).toBeUndefined();
    expect(await readCurrentLanes({ control: control([]) })).toEqual({ transactional: "smtp", bulk: "smtp" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readCurrentLanes({ control: control([], { describe: async () => { throw new Error("down"); } }) })).toBeUndefined();
    expect(logged.mock.calls[0]?.[0]).toBe("[mail] Could not read the current provider lanes");
    logged.mockRestore();
  });

  it("shows a split-lane setup before it is flattened, and nothing for a single lane", () => {
    expect(currentLanesDetail({})).toEqual([]);
    expect(currentLanesDetail({ current: { transactional: "a", bulk: "a" } })).toEqual([]);
    expect(currentLanesDetail({ current: { transactional: "a", bulk: null } })).toEqual([{ label: "Currently", value: "Transactional: a; bulk: none. Both lanes will use the new provider." }]);
    expect(currentLanesDetail({ current: { transactional: null, bulk: "b" } })[0]?.value).toBe("Transactional: none; bulk: b. Both lanes will use the new provider.");
  });
});

describe("provider operations", () => {
  it("activates after a passing check, forwarding the basis, and invalidates", async () => {
    const calls: unknown[] = [];
    const ctl = control([], { select: async (r) => { calls.push(r); }, invalidate: () => { calls.push("invalidate"); }, check: async ({ id }) => ({ ok: true, label: `L-${id}` }) });
    expect(await activateMailProvider({ control: ctl, providerId: "pm", principalId: "owner", expectedRevisionSeq: 4 })).toEqual({ set: true, providerId: "pm", label: "L-pm" });
    await activateMailProvider({ control: ctl, providerId: "pm", principalId: "owner" });
    expect(calls).toEqual([{ id: "pm", principalId: "owner", expectedRevisionSeq: 4 }, "invalidate", { id: "pm", principalId: "owner" }, "invalidate"]);
  });

  it("refuses without control, on a failing check, and maps only a revision conflict", async () => {
    await expect(activateMailProvider({ control: undefined, providerId: "pm", principalId: "o" })).rejects.toThrow("Mail provider selection is unavailable on this server. Nothing was changed.");
    const select = vi.fn(async () => {});
    await expect(activateMailProvider({ control: control([], { check: async () => ({ ok: false, reason: "pm: key missing" }), select }), providerId: "pm", principalId: "o" }))
      .rejects.toMatchObject({ code: "MAIL_PROVIDER_REFUSED", message: "Cannot switch to pm: key missing. Nothing was changed." });
    expect(select).not.toHaveBeenCalled();
    const conflict = new SettingsRevisionConflictError({ expectedRevisionSeq: 1, actualRevisionSeq: 2 });
    await expect(activateMailProvider({ control: control([], { select: async () => { throw conflict; } }), providerId: "pm", principalId: "o" })).rejects.toMatchObject({ code: "MAIL_PROVIDER_CHANGED" });
    const boom = new Error("db");
    await expect(activateMailProvider({ control: control([], { select: async () => { throw boom; } }), providerId: "pm", principalId: "o" })).rejects.toBe(boom);
  });

  it("creates the first key with token, username and an explicit base URL, and requires a token", async () => {
    const created: unknown[] = [];
    const credentials = { create: async (i: unknown) => { created.push(i); return { id: "new" }; }, describe: async () => null, update: async () => ({ id: "x" }) };
    const fresh = provider("smtp", { credential: { required: true, saved: true, label: "smtp-key", credentialId: "new" } });
    let saved = false;
    const ctl = control([provider("smtp")], { describe: async () => ({ setting: { transactional: null, bulk: null }, providers: saved ? [fresh] : [provider("smtp")], refusals: [] }), invalidate: () => { saved = true; } });
    expect(await saveMailProviderCredential({ control: ctl, credentials, workspaceId: "ws", providerId: "smtp", category: "c", input: { token: "tok-a", username: "u1", baseUrl: "h.example.test" } })).toEqual(fresh);
    expect(created).toEqual([{ workspaceId: "ws", label: "smtp-key", category: "c", baseUrl: "h.example.test", connection: { token: "tok-a", username: "u1" } }]);
    await saveMailProviderCredential({ control: control([provider("smtp")]), credentials, workspaceId: "ws", providerId: "smtp", category: "c", input: { token: "tok-b" } });
    expect(created[1]).toEqual({ workspaceId: "ws", label: "smtp-key", category: "c", baseUrl: undefined, connection: { token: "tok-b" } });
    await expect(saveMailProviderCredential({ control: control([provider("smtp")]), credentials, workspaceId: "ws", providerId: "smtp", category: "c", input: {} }))
      .rejects.toMatchObject({ code: "MAIL_PROVIDER_INPUT", message: "token is required to save the first key for 'smtp'." });
  });

  it("falls back to the planned provider when the fresh report no longer lists it; a rotation without token keeps the connection", async () => {
    const updates: unknown[] = [];
    const rotating = provider("pm", { credential: { required: true, saved: true, label: "pm-key", credentialId: "c1" } });
    let reads = 0;
    const ctl = control([rotating], { describe: async () => ({ setting: { transactional: null, bulk: null }, providers: reads++ === 0 ? [rotating] : [], refusals: [] }) });
    const result = await saveMailProviderCredential({ control: ctl, workspaceId: "ws", providerId: "pm", category: "c", input: { username: "u2", baseUrl: "b.example.test" },
      credentials: { create: async () => ({ id: "x" }), describe: async () => { throw new Error("must not read"); }, update: async (i) => { updates.push(i); return { id: "c1" }; } } });
    expect(result).toEqual(rotating);
    expect(updates).toEqual([{ workspaceId: "ws", id: "c1", username: "u2", baseUrl: "b.example.test" }]);
    await saveMailProviderCredential({ control: control([rotating]), workspaceId: "ws", providerId: "pm", category: "c", input: { token: "tok-c" },
      credentials: { create: async () => ({ id: "x" }), describe: async () => null, update: async (i) => { updates.push(i); return { id: "c1" }; } } });
    expect(updates[1]).toEqual({ workspaceId: "ws", id: "c1", connection: { token: "tok-c" } });
  });

  it("a plan omits the base URL when the provider declares none", async () => {
    expect((await planMailProviderCredential({ control: control([provider("pm")]), providerId: "pm", category: "c" })).credential).toEqual({ action: "create", label: "pm-key", category: "c" });
  });
});

it("the contributor and catalog name the same two read-only provider tools", () => {
  const contributor = contributeMailProviderTools();
  expect(contributor.domain).toBe("system-mail-providers");
  expect(contributor.build).toBe(buildMailProviderRegistrations);
  expect([...contributor.risk.entries()]).toEqual([...mailProviderDerivedRisk.entries()]);
  expect(mailProviderAgentToolCatalog.map((t) => [t.name, t.sideEffects])).toEqual([["mail_list_providers", "none"], ["mail_configure_provider", "none"]]);
});
