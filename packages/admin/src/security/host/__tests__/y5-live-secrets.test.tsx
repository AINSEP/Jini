// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useRemoveConfirmDialog, useAddCustomCredentialDialog } from "../AccessTokensTab.hooks.js";
import type { AccessTokenRow } from "../../access-token-rows.js";
import { SecretInput } from "../../../shell/components/SecretInput/SecretInput.js";
import { asciiSlug } from "../../../shell/lib/ascii-slug.js";

afterEach(cleanup);

test("removal confirmation closes the dialog before invoking the stored-row removal", () => {
  const events: string[] = [];
  const ref = { current: { close: () => events.push("close") } as unknown as HTMLDialogElement };
  const row = { id: "stored" } as AccessTokenRow;
  const removeToken = vi.fn(async () => { events.push("remove"); });
  const { result } = renderHook(() => useRemoveConfirmDialog({ ref, row, controller: { removeToken } }));
  expect(removeToken).not.toHaveBeenCalled();
  result.current.confirm();
  expect(events).toEqual(["close", "remove"]);
  expect(removeToken).toHaveBeenCalledWith(row);
});

test("a custom credential needs its key, and a failed save leaves the dialog open", async () => {
  const close = vi.fn();
  const controller = {
    customAddForm: { name: "Key", category: "general" as const, baseUrl: "https://example.test", additionalHosts: "", token: "", username: "" },
    resetCustomAddForm: vi.fn(), createCustomCredential: vi.fn(async () => false),
  };
  const ref = { current: { close } as unknown as HTMLDialogElement };
  const { result, rerender } = renderHook(() => useAddCustomCredentialDialog({ ref, controller }));
  expect(result.current.readyToSave).toBe(false);
  controller.customAddForm.token = "key";
  rerender();
  expect(result.current.readyToSave).toBe(true);
  await result.current.save();
  expect(close).not.toHaveBeenCalled();
  result.current.close();
  expect(close).toHaveBeenCalledOnce();
  expect(controller.resetCustomAddForm).toHaveBeenCalledOnce();
});

test("other stores retain search counts through a partial failure and serialize replacement before removal", async () => {
  const { act, waitFor } = await import("@testing-library/react");
  const { useSerialWrites } = await import("@jini-ai/ui/panel-kit");
  const { useOtherCredentials } = await import("../hooks/use-other-credentials.hooks.js");
  const data = { isSet: true, masked: "••••tail", provider: "host", baseUrl: null, model: null, updatedAt: null };
  const events: string[] = [];
  let release!: () => void;
  let configured = true;
  const port = {
    getSiteAssistantCredential: vi.fn(async () => ({ data: { ...data, isSet: configured } })),
    setSiteAssistantCredential: vi.fn(() => new Promise<{ data: typeof data }>(resolve => { release = () => { events.push("replace"); resolve({ data }); }; })),
    deleteSiteAssistantCredential: vi.fn(async () => { events.push("remove"); configured = false; return { data: { ...data, isSet: false } }; }),
    getAdminByokCredential: vi.fn(), setAdminByokCredential: vi.fn(), deleteAdminByokCredential: vi.fn(),
    getMediaProviders: vi.fn(async () => { throw new Error("media unavailable"); }), getMediaProviderCatalog: vi.fn(async () => null),
    patchMediaProvider: vi.fn(), removeMediaProvider: vi.fn(), listExternalMcpServers: vi.fn(), deleteExternalMcpServer: vi.fn(),
  };
  const stores = [{ id: "site-assistant" as const, label: "Assistant", category: "ai" as const, purposeLabel: "AI", supportsReplace: true, screenLabel: "Manage", screenPath: "/assistant" },
    { id: "media-provider" as const, label: "Media", category: "media" as const, purposeLabel: "Media", supportsReplace: true, screenLabel: "Manage", screenPath: "/media" }];
  const { result } = renderHook(() => useOtherCredentials({ port, t: key => key, locale: "en", filter: { query: "Assistant", category: "all" },
    hooks: { useSerialWrites, useContentRefreshSubscription: () => {} }, deps: {
      stores, resource: "credentials", credentialDraftError: () => null,
      formatCredentialHint: () => "", formatCredentialHints: () => "", translateCredentialMessage: ({ message }) => message,
      envNamesFact: () => "", maskedTailFact: ({ tail }) => tail,
      mediaProviderCatalogFrom: () => [], mediaProviderLabel: ({ providerId }) => providerId,
      otherCredentialMatchesQuery: ({ store, itemName, query }) => `${store.label} ${itemName ?? ""}`.includes(query),
      describeApiError: ({ e }) => String(e), accessTokensLoadErrorMessage: ({ error }) => error, accessTokenSaveErrorMessage: ({ error }) => error,
    } }));
  await waitFor(() => expect(result.current.groups).toHaveLength(2));
  expect(result.current.loadError).toContain("media unavailable");
  expect(result.current.totalCount).toBe(1);
  expect(result.current.matchCount).toBe(1);
  const row = result.current.groups?.[0]?.rows[0];
  if (!row) throw new Error("missing stored row");
  act(() => result.current.setDraftToken({ key: row.key, value: "replacement" }));
  let replacing!: Promise<void>;
  let removing!: Promise<void>;
  act(() => { replacing = result.current.replace(row); removing = result.current.remove(row); });
  await waitFor(() => expect(port.setSiteAssistantCredential).toHaveBeenCalledOnce());
  expect(port.deleteSiteAssistantCredential).not.toHaveBeenCalled();
  await act(async () => { release(); await replacing; await removing; });
  expect(events).toEqual(["replace", "remove"]);
  expect(result.current.totalCount).toBe(0);
  expect(result.current.matchCount).toBe(0);
});

test("five-query bootstrap preserves counts, stored removal never revokes upstream, and promotion survives a reconcile failure", async () => {
  const { act, waitFor } = await import("@testing-library/react");
  const { useAccessTokens } = await import("../hooks/use-access-tokens.hooks.js");
  const { useSettlementGeneration } = await import("@jini-ai/ui/panel-kit");
  const withPromotedDefault = <T extends { id: string; isDefault: boolean }>({ credentials, promoted }: { credentials: readonly T[]; promoted: T }) => credentials.map(row => ({ ...row, isDefault: row.id === promoted.id }));
  const first = { credentialType: "vendor" as const, configured: true as const, accountLabel: null, id: "first", providerId: "host", label: "Production", isDefault: true, maskedToken: "tail", updatedAt: "2026-01-01", createdAt: "2026-01-01", worksFor: ["host"] };
  const second = { ...first, id: "second", label: "Backup", isDefault: false };
  let saved = [first, second];
  let reconcileFails = false;
  const revokeUpstream = vi.fn();
  const port = {
    publish: {
      list: vi.fn(async () => { if (reconcileFails) throw new Error("reconcile failed"); return { credentials: saved, executionMode: "hosted-api-only" as const }; }),
      create: vi.fn(), update: vi.fn(async () => ({ ...second, isDefault: true })),
      remove: vi.fn(async ({ id }: { id: string }) => { saved = saved.filter(row => row.id !== id); }),
      revokeUpstream,
    },
    sourceControl: { list: vi.fn(async () => ({ credentials: [] })), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    custom: { list: vi.fn(async () => ({ credentials: [] })), create: vi.fn(), update: vi.fn(), remove: vi.fn(), useKey: vi.fn() },
    publishTargets: { list: vi.fn() }, sourceControlProviders: { list: vi.fn() },
  };
  const keys = new Set<string>();
  const snapshots: Record<string, unknown> = {
    "publish-credentials": { credentials: saved }, "source-control-credentials": { credentials: [] }, "custom-credentials": { credentials: [] },
    "publish-targets": [{ id: "host", label: "Host", configFields: [], credential: { tokenField: "token", fields: [{ name: "token", label: "Token", required: true }] } }],
    "source-control-providers": [],
  };
  const { localizePublishTargets, localizeSourceControlProviders } = await import("../../../shell/lib/descriptor-i18n.js");
  const deps = {
    ACCESS_TOKENS_RESOURCE: "credentials", ACCESS_TOKEN_CATEGORIES: [{ id: "all" as const, label: "All" }, { id: "hosting" as const, label: "Hosting" }],
    ACCESS_TOKEN_PROVIDER_COPY: { categories: [], publishPurposeLabel: "Hosting", sourceControlPurposeLabel: "Source control", customScopeGuidanceKey: "", customCredentialSubtitleKey: "Custom" },
    LEGACY_SENTINEL_LABELS: { publish: "default", "source-control": "default" },
    localizePublishTargets, localizeSourceControlProviders,
    sourceControlProviderInfoFromDescriptor: vi.fn(), withPromotedDefault,
    credentialDraftError: () => null, describeApiError: ({ e }: { e: unknown }) => String(e),
    isApiError: (_error: unknown): _error is import("@jini-ai/core/admin-runtime").AdminHttpError => false, translateCredentialMessage: ({ message }: { message: string }) => message,
    requiredFieldsFilled: () => true, suggestCredentialWorksFor: () => [],
    buildCredentialConnectionInput: vi.fn(), buildSourceControlConnectionInput: vi.fn(),
    accessTokenExistingRowReadyToSave: () => false, accessTokenRowReadyToSave: () => false,
    buildAccessTokenConnectionInput: vi.fn(), buildAccessTokenUpdatePatch: vi.fn(), classifyAccessTokenSubmitError: () => ({ kind: "generic" as const }),
  };
  let refresh = () => {};
  const hooks = {
    useFetchQuery: <T,>({ key }: { key: readonly string[]; fetch: () => Promise<T> }) => { keys.add(key[1]!); return { data: snapshots[key[1]!] as T, error: null, status: "success" }; },
    useContentRefreshSubscription: ({ onRefresh }: { onRefresh: () => void }) => { refresh = onRefresh; }, useSettlementGeneration,
  };
  const { result } = renderHook(() => useAccessTokens({ port, t: key => key, locale: "en", hooks, deps }));
  await waitFor(() => expect(result.current.totalCount).toBe(2));
  expect([...keys]).toEqual(["publish-credentials", "source-control-credentials", "custom-credentials", "publish-targets", "source-control-providers"]);
  act(() => result.current.setQuery("Backup"));
  expect(result.current.totalCount).toBe(2);
  expect(result.current.matchCount).toBe(1);
  const backup = result.current.groups?.[0]?.rows[0]?.row;
  if (!backup) throw new Error("missing backup row");
  reconcileFails = true;
  await act(() => result.current.makeDefault(backup));
  expect(result.current.groups?.[0]?.rows[0]?.row.isDefault).toBe(true);
  const picker = result.current.groups?.flatMap(group => group.rows).filter(state => state.row.isDefault).map(state => state.row.id);
  expect(picker).toEqual(["second"]);
  expect(result.current.groups?.[0]?.rows[0]?.error).toBeNull();
  reconcileFails = false;
  await act(() => result.current.removeToken(backup));
  expect(port.publish.remove).toHaveBeenCalledWith({ id: "second" });
  expect(revokeUpstream).not.toHaveBeenCalled();
  expect(result.current.totalCount).toBe(1);
  expect(result.current.matchCount).toBe(0);
  act(() => result.current.setQuery(""));
  expect(result.current.groups?.[0]?.rows[0]?.row.isDefault).toBe(true);
  let finishOlder!: () => void;
  let finishNewer!: () => void;
  port.publish.list.mockImplementationOnce(() => new Promise(resolve => { finishOlder = () => resolve({ credentials: [first], executionMode: "hosted-api-only" }); }));
  port.publish.list.mockImplementationOnce(() => new Promise(resolve => { finishNewer = () => resolve({ credentials: [first, second], executionMode: "hosted-api-only" }); }));
  act(() => { refresh(); refresh(); });
  await act(async () => { finishNewer(); });
  await waitFor(() => expect(result.current.totalCount).toBe(2));
  await act(async () => { finishOlder(); });
  expect(result.current.totalCount).toBe(2);
});

test("merged secrets rank saved other-store rows with provider groups and keep empty matching stores", async () => {
  const { useMergedSecretsOrder } = await import("../AccessTokensTab.hooks.js");
  const store = { id: "media-provider" as const, label: "Media", category: "media" as const, purposeLabel: "Media", supportsReplace: true, screenLabel: "Manage", screenPath: "/media" };
  const row = { key: "media-provider:alpha", store, itemId: "alpha", name: "Alpha", valueFact: "tail", updatedAt: null, token: "", saving: false, error: null };
  const info = { kind: "publish" as const, providerId: "host", label: "Zeta", category: "hosting" as const, vendorLabel: "Host", purposeLabel: "Hosting", tokenPageUrl: "", scopeGuidanceKey: "", extraFields: [] };
  const controller = { groups: [{ info, rows: [], addForm: { visible: false, name: "", token: "", values: {}, username: "", worksFor: [], readyToSave: false, saving: false, error: null } }] };
  const otherController = { groups: [{ store, rows: [row] }] };
  const { result, rerender } = renderHook(() => useMergedSecretsOrder({ controller, otherController, query: "", deps: {
    ACCESS_TOKEN_CATEGORIES: [{ id: "all", label: "All" }, { id: "hosting", label: "Hosting" }, { id: "media", label: "Media" }],
    otherCredentialMatchesQuery: () => true,
  } }));
  expect(result.current.map(entry => entry.key)).toEqual(["media-provider:alpha", "publish:host"]);
  otherController.groups = [{ store, rows: [] }];
  rerender();
  expect(result.current.map(entry => entry.key)).toContain("media-provider:none");
});

test("bound security keeps stable panel slots, resolves hook overrides, and requires key access", async () => {
  const { render, screen } = await import("@testing-library/react");
  const { bindSecurity } = await import("../../react/live/Security.js");
  const useAccessTokensHook = vi.fn();
  const override = vi.fn();
  const panels = { AccessTokens: () => <p>Tokens panel</p>, SiteKey: () => <p>Key panel</p>, Totp: () => null, RecoveryCodes: () => null, Passkeys: () => null };
  const createPanels = vi.fn(() => panels);
  let permitted = false;
  const BoundSecurity = bindSecurity({
    hooks: { useAdminLocaleHook: () => "en", useSecurityPermissionsHook: () => ({ canManageSiteKey: permitted }), useAccessTokensHook, useSiteKeyHook: vi.fn() },
    kit: { TabBar: ({ tabs }) => <nav>{tabs.map(tab => <span key={tab.id}>{tab.label}</span>)}</nav>, AccessTokensIcon: () => null, SiteKeyIcon: () => null },
    deps: { createPanels, copy: { t: ({ key }) => key, headerHandleLabel: "Header", accessTokensHandleLabel: "Tokens" }, onTabChange: vi.fn() },
  });
  const { rerender } = render(<BoundSecurity tabId="site-key" useAccessTokensHook={override} />);
  expect(screen.getByText("Tokens panel")).toBeTruthy();
  expect(screen.queryByText("Key panel")).toBeNull();
  expect(createPanels).toHaveBeenCalledWith(expect.objectContaining({ useAccessTokensHook: override }));
  rerender(<BoundSecurity tabId="site-key" useAccessTokensHook={override} />);
  expect(createPanels).toHaveBeenCalledOnce();
  permitted = true;
  rerender(<BoundSecurity tabId="site-key" useAccessTokensHook={override} />);
  expect(screen.getByText("Key panel")).toBeTruthy();
});

test("the live tab preserves combined search counts and disables custom Save until the key is present", async () => {
  const { render, screen } = await import("@testing-library/react");
  const { AccessTokensTab } = await import("../AccessTokensTab.js");
  const { useMergedSecretsOrder, useRemoveConfirmDialog, useAddCustomCredentialDialog } = await import("../AccessTokensTab.hooks.js");
  const controller = {
    groups: [], worksForOptions: [], loadError: null, query: "search", setQuery: vi.fn(), category: "all" as const, setCategory: vi.fn(), totalCount: 3, matchCount: 1,
    setExistingField: vi.fn(), replaceToken: vi.fn(), removeToken: vi.fn(), makeDefault: vi.fn(), openAddForm: vi.fn(), closeAddForm: vi.fn(), setAddField: vi.fn(), createToken: vi.fn(),
    customAddForm: { name: "Provider", category: "general" as const, baseUrl: "https://api.example.test", additionalHosts: "", token: "", username: "", worksFor: [], saving: false, error: null },
    setCustomAddField: vi.fn(), resetCustomAddForm: vi.fn(), createCustomCredential: vi.fn(), customKeyBusy: {}, setCustomKeyUse: vi.fn(), t: (key: string) => key,
  };
  const other = { groups: [], totalCount: 2, matchCount: 1, loadError: null, setDraftToken: vi.fn(), replace: vi.fn(), remove: vi.fn(), t: controller.t };
  const bindings = {
    hooks: {
      useAdminLocaleHook: () => "en", useAccessTokensHook: () => controller, useOtherCredentialsHook: () => other, useCopyKeysHook: vi.fn(() => ({ show: vi.fn() }) as unknown as import("../hooks/use-copy-keys.hooks.js").CopyKeysController),
      useMergedSecretsOrderHook: useMergedSecretsOrder, useRemoveConfirmDialogHook: useRemoveConfirmDialog, useAddCustomCredentialDialogHook: useAddCustomCredentialDialog,
      useTabBarKeyboardHook: () => ({ onKeyDown: vi.fn() }),
    },
    kit: { SecretInput, CredentialHint: () => null, OnboardingChipField: () => null, OtherCredentialEntry: () => null, ConnectedMarkIcon: () => null, DisclosureChevronIcon: () => null, SearchIcon: () => null },
    deps: {
      asciiSlug,
      ACCESS_TOKEN_CATEGORIES: [{ id: "all" as const, label: "All" }], ACCESS_TOKEN_PROVIDER_COPY: { categories: [], publishPurposeLabel: "Hosting", sourceControlPurposeLabel: "Source control", customScopeGuidanceKey: "", customCredentialSubtitleKey: "Custom" },
      showCopyKeysEntry: false, viewerTimeZone: "UTC", removeLabel: "Remove stored copy", customCredentialBaseUrlPlaceholder: "https://api.example.com",
      removeTokenHandleLabel: ({ provider }: { provider: string }) => `Remove ${provider}`,
      storedTokenNotice: "Stored encrypted. Never shown again.", hostingPluginsHref: "/plugins",
      providerGroupHandleLabel: vi.fn(), tokenRowHandleLabel: vi.fn(), fieldNameHandleSegment: vi.fn(), fieldHelpText: vi.fn(), accessTokenExtraFieldIdSuffix: vi.fn(),
      resolveTabBarTabIndex: () => 0,
      otherCredentialMatchesQuery: () => true,
      accessTokensCountText: ({ totalCount, matchCount }: { totalCount: number; matchCount: number }) => `${matchCount} of ${totalCount} tokens`,
      removeDialogTitle: vi.fn(), removeDialogBody: vi.fn(),
    },
  };
  const { rerender } = render(<AccessTokensTab {...bindings} showCopyKeysEntry={false} />);
  expect(screen.getByText("2 of 5 tokens")).toBeTruthy();
  expect(screen.getByRole("searchbox").getAttribute("autocomplete")).toBe("off");
  expect(screen.getByLabelText("Access token").getAttribute("autocomplete")).toBe("new-password");
  expect(screen.getByRole("button", { name: "Save", hidden: true })).toHaveProperty("disabled", true);
  controller.customAddForm.token = "required-key";
  rerender(<AccessTokensTab {...bindings} showCopyKeysEntry={false} />);
  expect(screen.getByRole("button", { name: "Save", hidden: true })).toHaveProperty("disabled", false);
});
