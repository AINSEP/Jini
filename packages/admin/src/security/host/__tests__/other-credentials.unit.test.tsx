// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSerialWrites } from "@jini-ai/ui/panel-kit";

import type { OtherCredentialsPort } from "../hooks/other-credentials-port.hooks.js";
import { bindOtherCredentials, useOtherCredentials, type OtherCredentialRowState, type OtherCredentialStoreInfo } from "../hooks/use-other-credentials.hooks.js";

/**
 * @file Drives `use-other-credentials.hooks.ts` and its `other-credential-store-operations.ts` readers
 * and writers over a stateful in-memory port: every write changes what the next read returns, so a
 * write routed to the wrong store, or a missing re-read, shows up as a stale row.
 */

type Hint = { tail: string } | null;
interface Server { serverId: string; label: string; builtIn: boolean; accessTokenHint: Hint; envTokenHints: Hint[]; envNames: string[] }
interface MediaEntry { apiKeyConfigured: boolean; apiKeyHint?: Hint; apiKeyTail?: string }

function memoryPort() {
  const state = {
    assistant: { isSet: true, masked: "••••a1", tokenHint: null as Hint, updatedAt: "2026-02-01" },
    byok: { isSet: true, masked: undefined as string | undefined, tokenHint: null as Hint, updatedAt: null as string | null },
    media: { cloud: { apiKeyConfigured: true, apiKeyHint: null, apiKeyTail: "c9" }, off: { apiKeyConfigured: false }, bare: { apiKeyConfigured: true } } as Record<string, MediaEntry>,
    servers: [
      { serverId: "docs", label: "", builtIn: false, accessTokenHint: null, envTokenHints: [], envNames: ["DOCS_KEY"] },
      { serverId: "core", label: "Core", builtIn: true, accessTokenHint: null, envTokenHints: [], envNames: [] },
      { serverId: "wiki", label: "Wiki", builtIn: false, accessTokenHint: null, envTokenHints: [{ tail: "w2" }], envNames: [] },
    ] as Server[],
  };
  const port = {
    getSiteAssistantCredential: vi.fn(async () => ({ data: { ...state.assistant } })),
    setSiteAssistantCredential: vi.fn(async () => ({ data: state.assistant })),
    deleteSiteAssistantCredential: vi.fn(async () => { state.assistant.isSet = false; return { data: state.assistant }; }),
    getAdminByokCredential: vi.fn(async () => ({ data: { ...state.byok } })),
    setAdminByokCredential: vi.fn(async ({ apiKey }: { apiKey: string }) => { state.byok = { ...state.byok, isSet: true, tokenHint: { tail: apiKey.slice(-2) } }; return { data: state.byok }; }),
    deleteAdminByokCredential: vi.fn(async () => { state.byok.isSet = false; return { data: state.byok }; }),
    getMediaProviders: vi.fn(async () => structuredClone(state.media)),
    getMediaProviderCatalog: vi.fn(async (): Promise<{ providers?: unknown }> => { throw new Error("catalog down"); }),
    patchMediaProvider: vi.fn(async ({ providerId, fields }: { providerId: string; fields: { apiKey: string } }) => { state.media[providerId] = { apiKeyConfigured: true, apiKeyTail: fields.apiKey.slice(-2) }; return state.media; }),
    removeMediaProvider: vi.fn(async ({ providerId }: { providerId: string }) => { delete state.media[providerId]; return state.media; }),
    listExternalMcpServers: vi.fn(async () => ({ servers: [...state.servers] })),
    deleteExternalMcpServer: vi.fn(async ({ serverId }: { serverId: string }) => { state.servers = state.servers.filter((s) => s.serverId !== serverId); }),
  };
  return { state, port, typed: port as unknown as OtherCredentialsPort };
}

const store = (id: OtherCredentialStoreInfo["id"], supportsReplace = true): OtherCredentialStoreInfo =>
  ({ id, label: `L-${id}`, category: "ai", purposeLabel: "AI", supportsReplace, screenLabel: "Manage", screenPath: `/${id}` });
const STORES = [store("site-assistant"), store("admin-byok"), store("media-provider"), store("external-mcp", false)];

const deps = {
  stores: STORES, resource: "credentials",
  formatCredentialHint: ({ hint }: { hint: unknown }) => (hint ? `hint(${(hint as { tail: string }).tail})` : ""),
  formatCredentialHints: ({ hints }: { hints: unknown }) => ((hints as Hint[]).length ? `hints(${(hints as { tail: string }[]).map((h) => h.tail).join()})` : ""),
  translateCredentialMessage: ({ message }: { message: string }) => `tr(${message})`,
  credentialDraftError: ({ value }: { value: string }) => (value === "bad" ? "draft-error" : null),
  envNamesFact: ({ envNames }: { envNames: readonly string[] }, { t }: { t: (key: string) => string }) => `${t("env")}(${envNames.join()})`,
  maskedTailFact: ({ tail }: { tail: string }) => `tail(${tail})`,
  mediaProviderCatalogFrom: vi.fn(({ body }: { body: unknown }) => (body ? [{ id: "cloud", label: "Cloud" }] : [])),
  mediaProviderLabel: ({ providerId, catalog }: { providerId: string; catalog: readonly { id: string; label: string }[] }) => catalog.find((c) => c.id === providerId)?.label ?? `raw(${providerId})`,
  otherCredentialMatchesQuery: () => true,
  describeApiError: ({ e, fallback }: { e: unknown; fallback: string }) => `${(e as Error).message}|${fallback}`,
  accessTokensLoadErrorMessage: ({ error }: { error: string }) => `load(${error})`,
  accessTokenSaveErrorMessage: ({ error }: { error: string }) => `save(${error})`,
};

async function loaded() {
  const mem = memoryPort();
  const hook = renderHook(() => useOtherCredentials({ port: mem.typed, t: (key) => `t(${key})`, locale: "en", filter: { query: "", category: "all" },
    hooks: { useSerialWrites, useContentRefreshSubscription: () => {} }, deps }));
  await waitFor(() => expect(hook.result.current.groups).toHaveLength(4));
  return { ...mem, ...hook };
}

type Loaded = Awaited<ReturnType<typeof loaded>>;
const facts = (hook: Loaded, id: OtherCredentialStoreInfo["id"]) =>
  hook.result.current.groups?.find((g) => g.store.id === id)?.rows.map((r) => [r.itemId, r.name, r.valueFact]);
const row = (hook: Loaded, key: string): OtherCredentialRowState => {
  const found = hook.result.current.groups?.flatMap((g) => g.rows).find((r) => r.key === key);
  if (!found) throw new Error(`row ${key} not on screen`);
  return found;
};

describe("other credential stores", () => {
  it("reads each store into rows with its own value fact, skipping unset, unconfigured and built-in items", async () => {
    const hook = await loaded();
    expect(facts(hook, "site-assistant")).toEqual([["site-assistant", "L-site-assistant", "tail(a1)"]]);
    expect(facts(hook, "admin-byok")).toEqual([["admin-byok", "L-admin-byok", "tail()"]]);
    expect(facts(hook, "media-provider")).toEqual([["cloud", "raw(cloud)", "tail(c9)"], ["bare", "raw(bare)", "tail()"]]);
    expect(deps.mediaProviderCatalogFrom).toHaveBeenCalledWith({ body: null });
    expect(facts(hook, "external-mcp")).toEqual([["docs", "docs", "t(env)(DOCS_KEY)"], ["wiki", "Wiki", "hints(w2)"]]);
    expect(hook.result.current.totalCount).toBe(6);
  });

  it("replaces the BYOK key and one media provider through their own writers, then re-reads that store", async () => {
    const hook = await loaded();
    act(() => hook.result.current.setDraftToken({ key: "admin-byok:admin-byok", value: "key-xy" }));
    await act(async () => { await hook.result.current.replace(row(hook, "admin-byok:admin-byok")); });
    expect(hook.port.setAdminByokCredential).toHaveBeenCalledWith({ apiKey: "key-xy" });
    expect(row(hook, "admin-byok:admin-byok")).toMatchObject({ valueFact: "hint(xy)", token: "", saving: false, error: null });

    act(() => hook.result.current.setDraftToken({ key: "media-provider:bare", value: "key-mq" }));
    await act(async () => { await hook.result.current.replace(row(hook, "media-provider:bare")); });
    expect(hook.port.patchMediaProvider).toHaveBeenCalledWith({ providerId: "bare", fields: { apiKey: "key-mq" } });
    expect(row(hook, "media-provider:bare").valueFact).toBe("tail(mq)");
    expect(hook.port.setSiteAssistantCredential).not.toHaveBeenCalled();
  });

  it("does not write for an empty draft, a store without Replace, or a draft error", async () => {
    const hook = await loaded();
    await act(async () => { await hook.result.current.replace(row(hook, "admin-byok:admin-byok")); });
    act(() => hook.result.current.setDraftToken({ key: "external-mcp:docs", value: "key-a" }));
    await act(async () => { await hook.result.current.replace(row(hook, "external-mcp:docs")); });
    act(() => hook.result.current.setDraftToken({ key: "media-provider:cloud", value: "bad" }));
    await act(async () => { await hook.result.current.replace(row(hook, "media-provider:cloud")); });
    expect(row(hook, "media-provider:cloud")).toMatchObject({ token: "bad", saving: false, error: "draft-error" });
    expect(hook.port.setAdminByokCredential).not.toHaveBeenCalled();
    expect(hook.port.patchMediaProvider).not.toHaveBeenCalled();
  });

  it("removes the BYOK key, one media provider and one MCP server, each through its own port call", async () => {
    const hook = await loaded();
    await act(async () => { await hook.result.current.remove(row(hook, "admin-byok:admin-byok")); });
    await act(async () => { await hook.result.current.remove(row(hook, "media-provider:cloud")); });
    await act(async () => { await hook.result.current.remove(row(hook, "external-mcp:wiki")); });
    expect(hook.port.deleteAdminByokCredential).toHaveBeenCalledOnce();
    expect(hook.port.removeMediaProvider).toHaveBeenCalledWith({ providerId: "cloud" });
    expect(hook.port.deleteExternalMcpServer).toHaveBeenCalledWith({ serverId: "wiki" });
    expect(hook.port.deleteSiteAssistantCredential).not.toHaveBeenCalled();
    expect(facts(hook, "admin-byok")).toEqual([]);
    expect(facts(hook, "media-provider")?.map((f) => f[0])).toEqual(["bare"]);
    expect(facts(hook, "external-mcp")?.map((f) => f[0])).toEqual(["docs"]);
  });

  it("keeps the typed token and shows the save sentence when a replace or a remove is rejected", async () => {
    const hook = await loaded();
    hook.port.setAdminByokCredential.mockRejectedValueOnce(new Error("quota"));
    act(() => hook.result.current.setDraftToken({ key: "admin-byok:admin-byok", value: "key-zz" }));
    await act(async () => { await hook.result.current.replace(row(hook, "admin-byok:admin-byok")); });
    expect(row(hook, "admin-byok:admin-byok")).toMatchObject({ token: "key-zz", saving: false, error: "save(tr(quota|t(unknown error)))" });

    hook.port.removeMediaProvider.mockRejectedValueOnce(new Error("busy"));
    await act(async () => { await hook.result.current.remove(row(hook, "media-provider:cloud")); });
    expect(row(hook, "media-provider:cloud")).toMatchObject({ token: "", saving: false, error: "save(tr(busy|t(unknown error)))" });
    expect(facts(hook, "media-provider")?.map((f) => f[0])).toEqual(["cloud", "bare"]);
  });

  it("binds the port, the host's locale and a translator that receives that locale", async () => {
    const mem = memoryPort();
    const translate = vi.fn(({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`);
    const useBound = bindOtherCredentials({ hooks: { useSerialWrites, useContentRefreshSubscription: () => {}, useLocaleHook: () => "fr" }, deps: { ...deps, port: mem.typed, translate } });
    const hook = renderHook(() => useBound({ query: "", category: "all" }));
    await waitFor(() => expect(hook.result.current.groups).toHaveLength(4));
    expect(hook.result.current.groups?.find((g) => g.store.id === "external-mcp")?.rows[0]?.valueFact).toBe("fr:env(DOCS_KEY)");
    expect(hook.result.current.t("unknown error")).toBe("fr:unknown error");
  });
});
