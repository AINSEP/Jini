// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminAgentPluginRow } from "@jini-ai/core/contracts/site/cms-agent-plugins";

import type { MailProviderConfigurationReport } from "../email-api.types.js";
import { useLoad } from "../hooks/email-load.hooks.js";
import { credentialBody, isFullyActive, useEmailProvider, useProviderChoices } from "../hooks/use-email-provider.hooks.js";

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
