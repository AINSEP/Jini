import { bindProviders } from "../providers/Providers.js";
import { TabBar } from "@jini-ai/ui/tab-strip";
import { cleanup, act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { EmailStatusFacts } from "../email/EmailSenderTab.js";
import { createEmailNavigate } from "../email/Email.hooks.js";
import { useScreenshotCleanup } from "../storage/hooks/use-screenshot-cleanup.hooks.js";

afterEach(cleanup);

test("email facts show the verified sender domain and omit absent domains", () => {
  const mounted = render(<EmailStatusFacts status={{ mailDeliveryAvailable: true, senderDomainVerification: { state: "verified", domain: "example.test", providerId: "mail" } }} locale="en" />);
  expect(screen.getByText("example.test")).toBeTruthy();
  expect(screen.getByText("Verified by the provider")).toBeTruthy();
  mounted.rerender(<EmailStatusFacts status={{ mailDeliveryAvailable: false }} locale="en" />);
  expect(screen.queryByText("example.test")).toBeNull();
});

test("email navigation encodes the section and preserves replace navigation", () => {
  const navigate = vi.fn();
  const go = createEmailNavigate({ deps: { navigate, routePath: "/email", tabKey: "tab", partKey: "p" } });
  go({ tabId: "sender", part: "dns & records/one" });
  expect(navigate).toHaveBeenLastCalledWith({ routePath: "/email?tab=sender&p=dns%20%26%20records%2Fone" }, { replace: true });
  go({ tabId: "overview", part: null });
  expect(navigate).toHaveBeenLastCalledWith({ routePath: "/email?tab=overview" }, { replace: true });
});

test("screenshot retention previews before cleanup and applies only the preview token", async () => {
  const preview = vi.fn(async () => ({ previewToken: "shown", deadline: 100, count: 1, bytes: 12, items: ["old.png"] }));
  const apply = vi.fn(async () => ({ deleted: ["old.png"], kept: [] }));
  const { result } = renderHook(() => useScreenshotCleanup({ client: { preview, apply }, describeError: () => "failed" }));
  await act(() => result.current.confirm());
  expect(apply).not.toHaveBeenCalled();
  await act(() => result.current.preview({ before: 25 }));
  expect(preview).toHaveBeenCalledWith({ before: 25 });
  expect(apply).not.toHaveBeenCalled();
  await act(() => result.current.confirm());
  expect(apply).toHaveBeenCalledExactlyOnceWith({ previewToken: "shown" });
});

test("providers localize labels, fall back to External MCP, and keep Soon bodies inert", () => {
  const useIntegrationsHook = vi.fn(() => { throw new Error("unmounted webhook controller"); });
  const kit: Parameters<typeof bindProviders>[0]["kit"] = {
    TabBar,
    I18nProvider: ({ children, initialLocale, syncDocumentAttributes }) => <section data-locale={initialLocale} data-sync={String(syncDocumentAttributes)}>{children}</section>,
    ExternalMcpSettingsPanel: ({ saveStatusLabel }) => <div>{saveStatusLabel ?? "external"}</div>,
    AlwaysAllowPanel: () => <div>allow</div>,
    McpServer: () => <button>demo command</button>,
    Webhooks: () => <button>demo webhook</button>,
    ComingSoonPanel: ({ children, label, note }) => <section><p>{label}</p><p>{note}</p><div inert>{children}</div></section>,
  };
  const Bound = bindProviders({ kit, hooks: {
    useExternalMcp: () => ({ dependencies: { port: { fetchSources: async () => [], addSource: async () => ({ ok: true }), removeSource: async () => true } }, restartRequired: true }),
    useAdminLocale: () => "fr", useAdminThemeBoundary: () => ({ "data-theme": "light" }), useIntegrationsHook,
  }, deps: {
    dictionaries: {}, t: ({ locale, key }) => `${locale}:${key}`, tIntegrations: ({ locale, key }) => `${locale}:${key}`,
    restartLabel: ({ locale }) => `${locale}:restart`, mcpServerHandleLabel: "host MCP", onTabChange: vi.fn(),
  } });
  const mounted = render(<Bound tabId="retired" />);
  expect(screen.getByText("fr:restart").closest("[data-locale]")?.getAttribute("data-locale")).toBe("fr");
  expect(screen.getByText("fr:restart").closest("[data-sync]")?.getAttribute("data-sync")).toBe("false");
  expect(screen.getByRole("heading", { name: "fr:Integrations" })).toBeTruthy();
  mounted.rerender(<Bound tabId="mcp-server" />);
  expect(screen.getByText("demo command").closest("[inert]")).toBeTruthy();
  expect(screen.getByText("fr:Nothing below is connected to anything yet.")).toBeTruthy();
  mounted.rerender(<Bound tabId="webhooks" />);
  expect(screen.getByText("demo webhook").closest("[inert]")).toBeTruthy();
  expect(useIntegrationsHook).not.toHaveBeenCalled();
});

test("media metadata saves only the edited fields from the mount baseline", async () => {
  const { useEditMediaPanel } = await import("../media/hooks/use-edit-media-panel.hooks.js");
  const { createFakeMediaPort } = await import("../media/hooks/fake-media-port.js");
  const { FetchQueryProvider, useFetchQuery, useFetchMutation } = await import("@jini-ai/ui/fetch-query");
  const item = { id: "one", workspaceId: "ws", title: "Old", slug: "old", alt: "old alt", caption: "", credit: "",
    sha256: "sha", status: "active" as const, createdAt: "", updatedAt: "", version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null, contentType: "image/png", publicUrl: null,
    description: "Stored description" };
  const port = createFakeMediaPort({ media: [item] });
  const update = vi.spyOn(port, "updateMedia");
  const onSaved = vi.fn();
  const { result, rerender } = renderHook(({ current }) => useEditMediaPanel({ item: current, onSaved, onCancel: vi.fn(),
    hooks: { useFetchQuery, useFetchMutation }, deps: {
      port, locale: "en", translate: ({ key }) => key,
      embedPolicy: { allowedAttributeNames: [], isAllowedAttributeName: () => false, parseAttributes: () => ({ attributes: {}, errors: [], error: null }) },
      embedMarkerSnippet: ({ value }) => value, writeText: vi.fn(), setTimeout,
      describeApiError: ({ e }) => String(e),
    } }), { initialProps: { current: item }, wrapper: FetchQueryProvider });
  act(() => result.current.setTitle("Mine"));
  rerender({ current: { ...item, alt: "Changed elsewhere" } });
  await act(() => result.current.save());
  expect(update).toHaveBeenLastCalledWith({ id: "one" }, { title: "Mine" });
  expect(onSaved).toHaveBeenCalledOnce();
  act(() => result.current.setDescription(" "));
  await act(() => result.current.save());
  expect(update).toHaveBeenLastCalledWith({ id: "one" }, { title: "Mine", description: "" });
});

test("media keeps the exact deep-link item available for editing and sends one pending upload", async () => {
  const { useMedia } = await import("../media/hooks/use-media.hooks.js");
  const { createFakeMediaPort } = await import("../media/hooks/fake-media-port.js");
  const { useMediaWrites } = await import("@jini-ai/cms/react/media/hooks/use-media-writes.hooks");
  const { FetchQueryProvider, useFetchQuery, useFetchMutation, useInvalidate } = await import("@jini-ai/ui/fetch-query");
  const item = { id: "linked", workspaceId: "ws", title: "Linked", slug: "linked", alt: "", caption: "", credit: "",
    sha256: "sha", status: "active" as const, createdAt: "", updatedAt: "", version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null, contentType: "image/png", publicUrl: null };
  const port = { ...createFakeMediaPort(), listMediaGrid: vi.fn() };
  const upload = vi.spyOn(port, "uploadMedia");
  let read!: (base64: string) => void;
  const readFileAsBase64 = vi.fn(() => new Promise<string>(resolve => { read = resolve; }));
  const useGridPages = vi.fn((_required: Parameters<Parameters<typeof useMedia>[0]["hooks"]["useGridPages"]>[0], _optional?: { itemId?: string | null | undefined }) => ({ items: [], exactItem: item, counts: null, hasUntypedActive: false,
    error: null, hasMore: false, loadingMore: false, loadMoreError: null, loadMore: vi.fn(), retryLoadMore: vi.fn() }));
  const { result } = renderHook(() => useMedia({ port, tab: "images", itemId: "linked", locale: "en", t: key => key,
    hooks: { useGridPages, useMediaWrites, useFetchQuery, useFetchMutation, useInvalidate, useContentRefreshSubscription: () => {} },
    deps: { readFileAsBase64, translate: ({ key }) => key, describeApiError: ({ e }) => String(e), sizeRefusalFromError: () => null },
  }), { wrapper: FetchQueryProvider });
  expect(useGridPages.mock.calls[0]?.[1]).toEqual({ itemId: "linked" });
  act(() => result.current.setEditingId("linked"));
  expect(result.current.editingItem).toEqual(item);
  const input = document.createElement("input");
  Object.defineProperty(input, "files", { value: [new File(["bytes"], "photo.png", { type: "image/png" })] });
  result.current.fileInputRef.current = input;
  let first!: Promise<void>;
  act(() => { first = result.current.upload(); });
  await act(() => result.current.upload());
  expect(readFileAsBase64).toHaveBeenCalledOnce();
  expect(upload).not.toHaveBeenCalled();
  await act(async () => { read("encoded"); await first; });
  expect(upload).toHaveBeenCalledExactlyOnceWith({ filename: "photo.png", contentType: "image/png", dataBase64: "encoded" }, { alt: undefined });
  expect(result.current.uploading).toBe(false);
  expect(result.current.uploadOpen).toBe(false);
});

test("plugin Add falls back to Installed when folder installation is unavailable", async () => {
  const { Plugins } = await import("../plugins/Plugins.js");
  const controller = {
    plugins: [], error: null, rowError: null, rowSavingId: null, expandedIds: new Set<string>(),
    inspectedPlugin: null, pendingRemovePlugin: null, settingsPlugin: null, settingsNotice: null,
    canInstallFolder: false, t: (key: string) => key, locale: "en",
    onToggleEnabled: vi.fn(), onRemovePlugin: vi.fn(), onToggleExpanded: vi.fn(), onInspectPlugin: vi.fn(),
    onCloseInspector: vi.fn(), onOpenSettings: vi.fn(), onCloseSettings: vi.fn(), onSettingsSaved: vi.fn(),
    dismissSettingsNotice: vi.fn(), onRequestRemove: vi.fn(), onConfirmRemove: vi.fn(), onCancelRemove: vi.fn(),
  };
  const { createPluginRules } = await import("../plugins/rules.js");
  const rules = createPluginRules({ productName: "Host", translate: ({ key }) => key,
    describeApiError: ({ fallback }) => fallback, isApiError: (_error): _error is Error => false,
    isProviderSettingRequired: () => false });
  render(<Plugins tabId="add" hooks={{ usePluginsHook: () => controller, useAdminLocale: () => "en",
    useWiredPluginPackageFiles: () => { throw new Error("no inspector"); },
    useWiredPluginProviderSettings: () => { throw new Error("no settings"); }, useProviderSettingsFocus: () => {} }}
    kit={{ TabBar, Toast: () => null, PluginProviderSettingsDialog: () => null }}
    deps={{ pluginRules: rules, pluginRemoveAriaLabel: rules.pluginRemoveAriaLabel,
      pluginRemoveBlocker: rules.pluginRemoveBlocker, pluginToggleAriaLabel: rules.pluginToggleAriaLabel,
      pluginToggleControl: rules.pluginToggleControl, translateAdminNavLabel: ({ key }) => key,
      onTabChange: vi.fn(), productName: "Host", builtInNote: "Bundled files stay", marketplaceNote: "No marketplace" }} />);
  expect(screen.getByRole("tab", { name: /Installed/ }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: /Add a plugin/ }).getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText("No plugins installed.")).toBeTruthy();
});

test("agent plugin Update passes the shown digest and install collaborators unchanged", async () => {
  const { AgentPluginUpdateSlot } = await import("../plugins/AgentPlugins.js");
  const { useAgentPluginUpdate } = await import("../plugins/hooks/use-agent-plugin-update.hooks.js");
  const { createPluginRules } = await import("../plugins/rules.js");
  const plugin = { pluginId: "notes", displayName: "Notes", version: "1", description: null, keywords: [],
    enabled: true, skills: [], mcpServerIds: [], origin: "operator-installed" as const, archiveDigest: "shown-digest" };
  const isApiError = (_error: unknown): _error is Error & { status: number } => false;
  const rules = createPluginRules({ productName: "Host", translate: ({ key }) => key,
    describeApiError: ({ fallback }) => fallback, isApiError, isProviderSettingRequired: () => false });
  const folderZip = { FOLDER_EMPTY: "empty", FOLDER_UNREADABLE: "unreadable",
    FolderZipError: class { readonly reason = "empty" as const; }, zipFolderFiles: async () => new File([], "folder.zip") };
  const useAgentPluginUpdateHook = vi.fn(useAgentPluginUpdate);
  const port = { sha256: async () => "sha", installZip: vi.fn() };
  const onUpdated = vi.fn();
  render(<AgentPluginUpdateSlot plugin={plugin} expectedOldDigest="shown-digest" t={key => key}
    agentHandleBase="notes" onUpdated={onUpdated} port={port} hooks={{ useAgentPluginUpdateHook }}
    deps={{ productName: "Host", isApiError, folderZip, pluginRules: rules }} />);
  expect(screen.getByRole("button", { name: "Update Notes" })).toBeTruthy();
  expect(useAgentPluginUpdateHook).toHaveBeenCalledWith({ plugin, expectedOldDigest: "shown-digest",
    port, t: expect.any(Function), onUpdated, productName: "Host", isApiError, folderZip, rules });
});
