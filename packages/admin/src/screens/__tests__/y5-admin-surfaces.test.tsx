// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { Media, type MediaProps } from "../media/Media.js";
import { bindProviders } from "../providers/Providers.js";
import { TabBar } from "@jini-ai/ui/tab-strip";
import { cleanup, act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { EmailStatusFacts } from "../email/EmailSenderTab.js";
import { createEmailNavigate } from "../email/Email.hooks.js";
import { useScreenshotCleanup } from "../storage/hooks/use-screenshot-cleanup.hooks.js";
import { parseMediaHtmlAttributes } from "../../media/html-attributes.js";
import { mediaFileName } from "../../media/rules.js";
import { BrowserAgentSettingsPanel } from "../webmcp/BrowserAgentSettingsPanel.js";
import { createAdminByokKeyPanelTranslator } from "../../shell/components/AdminByokKeyPanel.hooks.js";
import { PluginRulesProvider } from "../plugins/rules-context.js";
import { PluginPackageFilesModal } from "../plugins/PluginPackageFilesModal.js";
import { PluginRemoveConfirmDialog } from "../plugins/PluginRemoveConfirmDialog.js";
import { PluginRow } from "../plugins/PluginRow.js";
import { AddPluginPanel } from "../plugins/AddPluginPanel.js";
import { InstalledTabIcon, DownloadedTabIcon, MarketplaceTabIcon, PluginTrashIcon } from "../plugins/plugins-visuals.js";

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
      parseMediaHtmlAttributes,
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
    error: null, hasMore: false, loadingMore: false, loadMoreError: null, loadMore: vi.fn(), retryLoadMore: vi.fn(), retentionDays: null }));
  const { result } = renderHook(() => useMedia({ port, tab: "images", itemId: "linked", locale: "en", t: key => key,
    hooks: { useGridPages, useMediaWrites, useFetchQuery, useFetchMutation, useInvalidate, useContentRefreshSubscription: () => {} },
    deps: { readFileAsBase64, translate: ({ key }) => key, describeApiError: ({ e }) => String(e), sizeRefusalFromError: () => null, maxJsonUploadBytes: 1024 * 1024 },
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

test("settings preserve legacy redirects, valid tab control, fallback, scrolling and save feedback", async () => {
  const { bindSettingsUi } = await import("../settings/SettingsUi.js");
  const config: import("@jini-ai/core/contracts/execution").ExecutionConfig = {
    mode: "byok", byok: { protocol: "openai", providerId: null, apiKey: "", baseUrl: "", model: "" }, localCli: { agentId: null },
  };
  const port = { detectLocalAgents: async () => [], testConnection: async () => ({ ok: true }) };
  const save = { status: "saved" as const };
  const slice = <T,>(value: T) => ({ value, onChange: vi.fn(), loadError: null, saveState: save, refresh: async () => {} });
  const state: ReturnType<Parameters<typeof bindSettingsUi>[0]["hooks"]["useSettingsUiHook"]> = {
    loading: false, loadError: null, save, port,
    execution: slice(config), instructions: slice(""), language: slice("fr"),
    notifications: slice({ soundEnabled: true, successSoundId: "ok", failureSoundId: "no", desktopEnabled: false }),
    privacy: slice({ telemetry: { metrics: false }, installationId: null, privacyDecisionAt: null }),
    interface: slice({ hideChatFabWhileOpen: true, wrapTabs: false, adminTheme: "classic" }),
    memoryTopTab: "memories", setMemoryTopTab: vi.fn(),
  };
  const navigate = vi.fn();
  const useSettingsActiveTabScrollHook = vi.fn(() => ({ current: null }));
  const useSettingsLocaleSyncHook = vi.fn();
  const noop = () => null;
  const Bound = bindSettingsUi({
    hooks: {
      useAdminThemeBoundaryHook: () => ({ "data-theme": "light" }), useSettingsUiHook: () => state,
      useSettingsActiveTabScrollHook, useSettingsLocaleSyncHook,
      useSettingsExecutionHook: () => ({ config, onConfigChange: vi.fn(), subtitleKey: "Execution", visibility: "hidden", note: null, unavailableReason: "BYOK" }),
      useExecutionPolicy: () => ({ config, allowed: false, readAllowedForSend: async () => false, visibility: "hidden", note: null, preserveChange: next => next, subtitleKey: "Execution" }),
      useAiAgentPresentationHook: () => ({ port, scopeCopy: "server", warning: null }),
      useAdminExecutionCredentialHook: () => ({ stored: null, apiKeyStoredExternally: false, apiKeyPlaceholder: undefined,
        storedKeyIsForOtherEndpoint: false, canDiscoverModels: true, saveState: save, settingsSaveState: save, canSaveKey: false,
        saveKey: async () => {}, saveSettings: async () => {}, legacyKey: null, migrateLegacyKey: async () => {}, dismissLegacyPrompt: vi.fn() }),
      useAdminLocale: () => "fr", useUserInterfaceTab: () => ({ hideChatFabWhileOpen: true, wrapTabs: false, toggleHideChatFabWhileOpen: vi.fn(), toggleWrapTabs: vi.fn() }),
      useAdminBrowserAgentSettings: () => ({ enabled: false, busy: false, error: null, setEnabled: async () => {} }),
    },
    kit: {
      I18nProvider: ({ children }) => <>{children}</>,
      SettingsDialogShell: ({ tabs, activeTabId, chromeExtra, onActiveTabIdChange }) => <div>
        <span>{activeTabId ?? tabs[0]?.id}</span>{chromeExtra}
        <button onClick={() => onActiveTabIdChange?.("language")}>change tab</button>
      </div>,
      ExecutionTab: noop, InstructionsTab: noop, NotificationsTab: noop, PrivacyTab: noop,
      LanguageTab: noop, MemorySettingsPanel: noop, Workspace: noop, AboutPanel: noop,
      AdminByokMigrationPrompt: noop, AdminByokKeyFooter: noop, AdminByokSettingsFooter: noop, BrowserAgentSettingsPanel,
    },
    deps: {
      navigate, createAdminByokKeyPanelTranslator, createSettingsTabChange: () => (nextTabId) => navigate({ routePath: `/settings?tab=${nextTabId}` }, { replace: true }),
      SETTINGS_DIALOG_DICTIONARIES: {}, ADMIN_LOCALES: [], DEFAULT_INSTRUCTIONS: "", DEFAULT_EXECUTION_CONFIG: config,
      tApp: ({ key }) => key, tCapability: ({ key }) => key, tWorkspace: ({ key }) => key,
      DEFAULT_PROVIDER_PRESETS: [], isDesktopAdmin: () => false, defaultLocalAgentId: "local", scopeKeys: { desktopKey: "desktop", serverKey: "server" },
      SETTINGS_EXECUTION_PRODUCT_VARS: { productName: "Host" }, createProbeErrorDescriber: () => () => "probe",
      resolveAdminByokFooterStatusLine: () => "", webMcpT: ({ key }) => key,
      memoryUnavailableNote: "Memory unavailable", localCliDataAttribute: "data-host-local-cli",
      legacySkillsPath: "/addons/skills", legacyAppearancePath: "/admin-ui?tab=appearance", now: () => 1,
    },
  });
  const mounted = render(<Bound tabId="skills" />);
  expect(navigate).toHaveBeenLastCalledWith({ routePath: "/addons/skills" }, { replace: true });
  expect(screen.getByText("execution")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Enregistré");
  expect(useSettingsActiveTabScrollHook).toHaveBeenLastCalledWith({ ready: true, tabId: "skills" });
  expect(useSettingsLocaleSyncHook).toHaveBeenLastCalledWith({ locale: "fr" });
  mounted.rerender(<Bound tabId="appearance" />);
  expect(navigate).toHaveBeenLastCalledWith({ routePath: "/admin-ui?tab=appearance" }, { replace: true });
  mounted.rerender(<Bound tabId="privacy" />);
  expect(screen.getByText("privacy")).toBeTruthy();
  mounted.rerender(<Bound tabId="missing" />);
  expect(screen.getByText("execution")).toBeTruthy();
  act(() => screen.getByText("change tab").click());
  expect(navigate).toHaveBeenLastCalledWith({ routePath: "/settings?tab=language" }, { replace: true });
});

test("media screen preserves the exact deep-link lookup and shares the live provider catalog with its tab count", () => {
  const linked = { id: "linked", workspaceId: "ws", title: "Linked", slug: "linked", alt: "", caption: "", credit: "",
    sha256: "sha", status: "active" as const, createdAt: "", updatedAt: "", version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null, contentType: "image/png", publicUrl: null };
  const useMediaItemLinkHook = vi.fn<MediaProps["hooks"]["useMediaItemLinkHook"]>(() => ({ notFound: false }));
  const useMediaHook = vi.fn<MediaProps["hooks"]["useMediaHook"]>(() => ({
    media: [], lookupMedia: [linked], editingItem: linked, editingId: "linked", setEditingId: vi.fn(),
    counts: { all: 41, images: 40, videos: 1, trash: 2 }, retentionDays: null, error: null, uploading: false,
    uploadOpen: false, openUpload: vi.fn(), closeUpload: vi.fn(), uploadError: null, conversionNotice: null,
    canUpload: false, altDraft: "", setAltDraft: vi.fn(), fileInputRef: { current: null }, selectedFileName: "",
    onFileChange: vi.fn(), upload: vi.fn(async () => {}), hasUntypedActive: false,
    hasMore: false, loadingMore: false, loadMoreError: null, loadMore: vi.fn(async () => {}),
    toggleEditing: vi.fn(), onMetadataSaved: vi.fn(), trash: vi.fn(async () => {}), restore: vi.fn(async () => {}),
    pendingPurge: null, setPendingPurge: vi.fn(), rowSavingId: null, purge: vi.fn(async () => {}),
    lightboxIndex: null, setLightboxIndex: vi.fn(), orderBy: "created", setOrderBy: vi.fn(), t: key => key, locale: "fr",
  }));
  const port = { fetchMediaProviderCatalog: vi.fn(async () => []) };
  const catalog: NonNullable<ReturnType<MediaProps["hooks"]["useMediaProviderCatalogHook"]>> = [];
  const useMediaProviderCatalogHook = vi.fn<MediaProps["hooks"]["useMediaProviderCatalogHook"]>(() => catalog);
  const ExternalProvidersPanel = vi.fn((_props: ComponentProps<MediaProps["kit"]["ExternalProvidersPanel"]>) => <p>live providers</p>);
  const props: MediaProps = {
    itemId: "linked", tabId: "external-providers",
    hooks: { useMediaHook, useMediaItemLinkHook, useMediaProviderCatalogHook,
      useMediaTabsHook: () => ({ activeTab: "external-providers", setActiveTab: vi.fn() }),
      useMediaPreviewHook: vi.fn(), useEditMediaPanelHook: vi.fn(), useEditMediaModalHook: vi.fn(),
      useAdminKitValuesHook: vi.fn(), useMediaCardMetadataHook: vi.fn(), useMediaCardDetailsHook: vi.fn(),
      useMediaGridSizeHook: vi.fn(), useAdminThemeBoundaryHook: vi.fn(), useRemoteImageImport: vi.fn(), useFetchMutation: vi.fn(),
    },
    kit: { ExternalProvidersPanel, PublishSectionButton: () => <button>publish media</button>,
      TabBar: ({ tabs }) => <div>{tabs.map(tab => <span key={tab.id}>{tab.label}:{tab.count}</span>)}</div>,
      Icon: () => null, RowMenu: () => null, ConfirmDialog: () => null, ServerLabel: () => null,
      ChromePlaybackNote: () => null, EyeIcon: () => null, ExpandIcon: () => null, PlaceholderIcon: () => null,
      PlayIcon: () => null, UploadIcon: () => null, MediaLoadMore: () => null, DockHeaderTip: ({ children }) => <>{children}</>,
      InfoTip: () => null, Lightbox: () => null, MiddleTruncate: () => null, RemoteImageImport: () => null,
      Button: () => null, Dialog: () => null, TextField: () => null,
    },
    deps: { mediaProviderCatalogPort: port, mediaFileName, VIEWER_TIME_ZONE: "UTC", MEDIA_GRID_SIZE_STORAGE_KEY: "host.media.cardSize",
      mediaTranslate: ({ key }) => key, VIDEO_CONVERSION_NOTICE_KEY: "conversion notice",
      defaultMediaImportPort: { importFromUrl: vi.fn(), listKey: ["media"] }, describeApiError: ({ e }) => String(e),
    },
  };
  render(<Media {...props} />);
  expect(useMediaHook).toHaveBeenCalledExactlyOnceWith({ tab: "all", itemId: "linked" });
  expect(useMediaItemLinkHook).toHaveBeenCalledExactlyOnceWith({ itemId: "linked", activeTab: "external-providers",
    media: [linked], editingId: "linked", setEditingId: expect.any(Function) });
  expect(useMediaProviderCatalogHook).toHaveBeenCalledExactlyOnceWith({ port });
  expect(ExternalProvidersPanel.mock.calls[0]?.[0]).toEqual({ locale: "fr", catalog,
    useAdminThemeBoundaryHook: props.hooks.useAdminThemeBoundaryHook });
  expect(screen.getByText("All:41")).toBeTruthy();
  expect(screen.getByText("External Providers:0")).toBeTruthy();
  expect(screen.getByRole("button", { name: "publish media" })).toBeTruthy();
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
    kit={{ TabBar, Toast: () => null, PluginProviderSettingsDialog: () => null, PluginRulesProvider, PluginPackageFilesModal,
      PluginRemoveConfirmDialog, PluginRow, AddPluginPanel, InstalledTabIcon, DownloadedTabIcon, MarketplaceTabIcon, PluginTrashIcon }}
    deps={{ pluginRules: rules, pluginRemoveAriaLabel: rules.pluginRemoveAriaLabel,
      pluginRemoveBlocker: rules.pluginRemoveBlocker, pluginToggleAriaLabel: rules.pluginToggleAriaLabel,
      pluginToggleControl: rules.pluginToggleControl, translateAdminNavLabel: ({ key }) => key,
      onTabChange: vi.fn(), productName: "Host", builtInNote: "Bundled files stay", marketplaceNote: "No marketplace" }} />);
  expect(screen.getByRole("tab", { name: /Installed/ }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: /Add a plugin/ }).getAttribute("aria-disabled")).toBe("true");
  expect(screen.getByText("No plugins installed.")).toBeTruthy();
});

test("agent plugin Update passes the shown digest and install collaborators unchanged", async () => {
  const { AgentPluginUpdateSlot } = await import("../plugins/AgentPluginUpdateControl.js");
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
