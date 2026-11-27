// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminAgentPluginRow } from "@jini-ai/core/contracts/site/cms-agent-plugins";

import type { EmailApi, MailProviderConfiguration, MailProviderConfigurationReport } from "../email-api.types.js";
import { useLoad } from "../hooks/email-load.hooks.js";
import { credentialBody, isFullyActive, useEmailProvider, useProviderChoices, type EmailProviderPluginApi } from "../hooks/use-email-provider.hooks.js";

/** @file The provider hook with every host seam injected: the transport error class, the plugins client, the email client. */
class FakeApiError extends Error { readonly status: number; constructor({ message, status }: { message: string; status: number }) { super(message); this.status = status; } }
const mail = (over: Partial<AdminAgentPluginRow> = {}): AdminAgentPluginRow => ({ pluginId: "mail-plugin", provides: ["outbound-mail"], enabled: false, version: null, description: null, keywords: [], skills: [], mcpServerIds: [], ...over });
const report: MailProviderConfigurationReport = { setting: { transactional: null, bulk: null }, providers: [], refusals: [] };
/** The two data hooks the host binds (required on the args object). */
const hooks = { useLoadHook: useLoad, useProviderChoicesHook: useProviderChoices };
function ports() {
  return {
    api: { listProviders: vi.fn(async () => report), saveProviderKey: vi.fn(), activateProvider: vi.fn() },
    pluginApi: { listAgentPlugins: vi.fn(async () => ({ agentPlugins: [mail(), mail({ pluginId: "on", enabled: true }), mail({ pluginId: "other", provides: ["search"] })] })), setAgentPluginEnabled: vi.fn(async () => ({})) },
  };
}

describe("useEmailProvider (injected seams)", () => {
  it("offers only disabled outbound-mail plugins and never enables one on its own", async () => {
    const p = ports();
    const { result } = renderHook(() => useEmailProvider({ ...p, ApiError: FakeApiError, ...hooks }));
    await waitFor(() => expect(result.current.choices?.map((row) => row.pluginId)).toEqual(["mail-plugin"]));
    expect(p.pluginApi.setAgentPluginEnabled).not.toHaveBeenCalled();
  });

  it("reports the injected ApiError's safe message when the plugin list is refused", async () => {
    const p = ports();
    p.pluginApi.listAgentPlugins.mockRejectedValueOnce(new FakeApiError({ message: "Cannot list plugins", status: 403 }));
    const { result } = renderHook(() => useEmailProvider({ ...p, ApiError: FakeApiError, ...hooks }));
    await waitFor(() => expect(result.current.addError).toBe("Cannot list plugins"));
    expect(result.current.choices).toBeNull();
  });

  it("falls back to the missing-provider line when enabling loads no adapter, and keeps drafts", async () => {
    const p = ports();
    const { result } = renderHook(() => useEmailProvider({ ...p, ApiError: FakeApiError, ...hooks }));
    await waitFor(() => expect(result.current.view.kind).toBe("loaded"));
    act(() => result.current.setDraftField("hosted", "token", "keep"));
    await act(async () => { expect(await result.current.addProvider({ pluginId: "mail-plugin" })).toBeUndefined(); });
    expect(result.current.addError).toBe("The plugin did not load an email provider.");
    expect(result.current.drafts.hosted?.token).toBe("keep");
  });
});

describe("pure helpers", () => {
  it("credentialBody trims and drops blank parts", () => {
    expect(credentialBody({ draft: { token: " s ", username: "  ", baseUrl: " u " } })).toEqual({ token: "s", baseUrl: "u" });
    expect(credentialBody({ draft: undefined })).toEqual({});
  });
  it("isFullyActive needs both lanes", () => {
    expect(isFullyActive({ provider: { lanes: ["transactional"] } as never })).toBe(false);
    expect(isFullyActive({ provider: { lanes: ["transactional", "bulk"] } as never })).toBe(true);
  });
});

const fixtureProvider: MailProviderConfiguration = {
  id: "relay", label: "Relay", pluginId: "mail-plugin", origin: "plugin", lanes: ["transactional"], hosted: true,
  capabilities: { feedback: true, domainVerification: false }, credential: { required: true, saved: false },
  selectable: true, setup: { fields: [] },
};

it("retries a refused plugins list before any enable has been attempted", async () => {
  const p = ports();
  p.pluginApi.listAgentPlugins.mockRejectedValueOnce(new FakeApiError({ message: "Plugin registry unavailable", status: 503 }));
  const { result } = renderHook(() => useEmailProvider({ ...p, ApiError: FakeApiError, ...hooks }));
  await waitFor(() => expect(result.current.addError).toBe("Plugin registry unavailable"));
  await act(async () => { expect(await result.current.retryAdd()).toBeUndefined(); });
  await waitFor(() => expect(result.current.choices?.map(row => row.pluginId)).toEqual(["mail-plugin"]));
  expect(result.current.addError).toBeNull();
  expect(p.pluginApi.listAgentPlugins.mock.calls).toEqual([[], []]);
  expect(p.pluginApi.setAgentPluginEnabled).not.toHaveBeenCalled();
});

it("keeps the selected enable attempt exclusive and returns only its refreshed provider", async () => {
  const p = ports();
  const enable = vi.fn<EmailProviderPluginApi["setAgentPluginEnabled"]>();
  let release!: (answer: { warnings?: string[] }) => void;
  enable.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const pluginApi = { ...p.pluginApi, setAgentPluginEnabled: enable };
  const other = { ...fixtureProvider, id: "other", pluginId: "other-plugin" };
  p.api.listProviders.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, providers: [other, fixtureProvider] });
  const { result } = renderHook(() => useEmailProvider({ ...p, pluginApi, ApiError: FakeApiError, ...hooks }));
  await waitFor(() => expect(result.current.choices?.map(row => row.pluginId)).toEqual(["mail-plugin"]));

  let add!: Promise<string | undefined>;
  act(() => { add = result.current.addProvider({ pluginId: "mail-plugin" }); });
  expect(result.current.adding).toBe("mail-plugin");
  await act(async () => { expect(await result.current.addProvider({ pluginId: "other-plugin" })).toBeUndefined(); });
  await act(async () => { release({ warnings: ["Secret needs setup.", "Check DNS."] }); await expect(add).resolves.toBe("relay"); });
  expect(enable.mock.calls).toEqual([[{ pluginId: "mail-plugin", enabled: true }]]);
  expect(result.current.addWarning).toBe("Secret needs setup. Check DNS.");
  expect(result.current.choices).toEqual([]);
  expect(result.current.view).toMatchObject({ kind: "loaded", data: { providers: [other, fixtureProvider] } });
  expect(result.current.adding).toBeNull();
});

it("reports only the chosen plugin’s refusal and retries that plugin after a load failure", async () => {
  const p = ports();
  p.api.listProviders
    .mockResolvedValueOnce(report)
    .mockResolvedValueOnce({ ...report, refusals: ["Refused provider from 'other-plugin'", "Credential missing from 'mail-plugin'"] })
    .mockResolvedValueOnce({ ...report, providers: [fixtureProvider] });
  const { result } = renderHook(() => useEmailProvider({ ...p, ApiError: FakeApiError, ...hooks }));
  await waitFor(() => expect(result.current.choices?.map(row => row.pluginId)).toEqual(["mail-plugin"]));
  await act(async () => { expect(await result.current.addProvider({ pluginId: "mail-plugin" })).toBeUndefined(); });
  expect(result.current.addError).toBe("Credential missing from 'mail-plugin'");
  expect(result.current.choices?.map(row => row.pluginId)).toEqual(["mail-plugin"]);
  await act(async () => { expect(await result.current.retryAdd()).toBe("relay"); });
  expect(p.pluginApi.setAgentPluginEnabled.mock.calls).toEqual([
    [{ pluginId: "mail-plugin", enabled: true }], [{ pluginId: "mail-plugin", enabled: true }],
  ]);
  expect(result.current.addError).toBeNull();
  expect(result.current.choices).toEqual([]);
});

it("requires a first credential, keeps it on refusal, then clears only the stored draft after saving", async () => {
  const p = ports();
  const saveProviderKey = vi.fn<EmailApi["saveProviderKey"]>()
    .mockRejectedValueOnce(new FakeApiError({ status: 422, message: "Credential could not be validated" }));
  let release!: (answer: { provider: MailProviderConfiguration }) => void;
  saveProviderKey.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const onChanged = vi.fn();
  const api = { ...p.api, saveProviderKey };
  const { result } = renderHook(() => useEmailProvider({ ...p, api, ApiError: FakeApiError, ...hooks }, { onChanged }));
  await waitFor(() => expect(result.current.view.kind).toBe("loaded"));
  await act(async () => { await result.current.saveKey(fixtureProvider); });
  expect(result.current.notice).toEqual({ providerId: "relay", tone: "error", text: "Enter the key first." });
  expect(saveProviderKey).not.toHaveBeenCalled();
  act(() => result.current.setDraftField("other", "username", "keep"));
  expect(result.current.notice?.providerId).toBe("relay");
  act(() => result.current.setDraftField("relay", "token", "  fixture-token  "));
  expect(result.current.notice).toBeNull();

  await act(async () => { await result.current.saveKey(fixtureProvider); });
  expect(result.current.notice?.text).toBe("Credential could not be validated");
  expect(result.current.drafts.relay).toEqual({ token: "  fixture-token  " });
  expect(onChanged).not.toHaveBeenCalled();
  const saved = { ...fixtureProvider, credential: { required: true, saved: true } };
  p.api.listProviders.mockResolvedValue({ ...report, providers: [saved] });
  let save!: Promise<void>;
  act(() => { save = result.current.saveKey(fixtureProvider); });
  expect(result.current.busyId).toBe("relay");
  await act(async () => { release({ provider: saved }); await save; });
  expect(saveProviderKey.mock.calls).toEqual([
    [{ providerId: "relay", input: { token: "fixture-token" } }],
    [{ providerId: "relay", input: { token: "fixture-token" } }],
  ]);
  await waitFor(() => expect(result.current.view).toMatchObject({ kind: "loaded", data: { providers: [saved] } }));
  expect(result.current.drafts).toEqual({ relay: {}, other: { username: "keep" } });
  expect(result.current.notice).toEqual({ providerId: "relay", tone: "ok", text: "Key saved." });
  expect(result.current.busyId).toBeNull();
  expect(p.api.activateProvider).not.toHaveBeenCalled();
  expect(onChanged.mock.calls).toEqual([[]]);
});

it("switches only after confirmation, reporting a refusal and a successful retry separately", async () => {
  const p = ports();
  const switched = { ...fixtureProvider, lanes: ["transactional", "bulk"] } satisfies MailProviderConfiguration;
  const activateProvider = vi.fn<EmailApi["activateProvider"]>()
    .mockRejectedValueOnce(new FakeApiError({ status: 409, message: "Provider is not ready" }))
    .mockResolvedValueOnce({ set: true, label: "Relay", providerId: "relay" });
  const api = { ...p.api, activateProvider };
  const onChanged = vi.fn();
  const { result } = renderHook(() => useEmailProvider({ ...p, api, ApiError: FakeApiError, ...hooks }, { onChanged }));
  await waitFor(() => expect(result.current.view.kind).toBe("loaded"));
  await act(async () => { await result.current.confirmSwitch(); });
  act(() => result.current.askSwitch(fixtureProvider));
  expect(activateProvider).not.toHaveBeenCalled();
  await act(async () => { await result.current.confirmSwitch(); });
  expect(result.current.notice).toEqual({ providerId: "relay", tone: "error", text: "Provider is not ready" });
  expect(result.current.pendingSwitch).toBeNull();
  expect(onChanged).not.toHaveBeenCalled();
  p.api.listProviders.mockResolvedValue({ setting: { bulk: "relay", transactional: "relay" }, providers: [switched], refusals: [] });

  act(() => result.current.askSwitch(fixtureProvider));
  await act(async () => { await result.current.confirmSwitch(); });
  expect(activateProvider.mock.calls).toEqual([[{ providerId: "relay" }], [{ providerId: "relay" }]]);
  expect(result.current.pendingSwitch).toBeNull();
  expect(result.current.busyId).toBeNull();
  expect(result.current.notice).toEqual({ providerId: "relay", tone: "ok", text: "Now sending with this provider." });
  await waitFor(() => expect(result.current.view).toMatchObject({ kind: "loaded", data: { providers: [switched] } }));
  expect(onChanged.mock.calls).toEqual([[]]);
});

it("allows rotating only the username on a stored key without sending a blank token", async () => {
  const p = ports();
  const saved = { ...fixtureProvider, credential: { required: true, saved: true } };
  const saveProviderKey = vi.fn<EmailApi["saveProviderKey"]>().mockResolvedValue({ provider: saved });
  const api = { ...p.api, saveProviderKey };
  const { result } = renderHook(() => useEmailProvider({ ...p, api, ApiError: FakeApiError, ...hooks }));
  await waitFor(() => expect(result.current.view.kind).toBe("loaded"));
  act(() => {
    result.current.setDraftField("relay", "token", "  ");
    result.current.setDraftField("relay", "username", "  service-account  ");
  });
  await act(async () => { await result.current.saveKey(saved); });
  expect(saveProviderKey.mock.calls).toEqual([[{ providerId: "relay", input: { username: "service-account" } }]]);
  expect(result.current.notice).toEqual({ providerId: "relay", tone: "ok", text: "Key saved." });
});
