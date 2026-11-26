import type { ComponentProps } from "react";
import { Media, type MediaProps } from "../media/Media.js";
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
    I18nProvider: ({ children }) => <>{children}</>,
    ExternalMcpSettingsPanel: ({ saveStatusLabel }) => <div>{saveStatusLabel ?? "external"}</div>,
    AlwaysAllowPanel: () => <div>allow</div>,
    McpServer: () => <button>demo command</button>,
    Webhooks: () => <button>demo webhook</button>,
    ComingSoonPanel: ({ children, label, note }) => <section><p>{label}</p><p>{note}</p><div inert>{children}</div></section>,
  };
  const Bound = bindProviders({ kit, hooks: {
    useProvidersHook: () => ({ externalMcp: { dependencies: { port: { fetchSources: async () => [], addSource: async () => ({ ok: true }), removeSource: async () => true } }, restartRequired: true } }),
    useAdminLocale: () => "fr", useAdminThemeBoundary: () => ({ "data-theme": "light" }), useIntegrationsHook,
  }, deps: {
    dictionaries: {}, t: ({ locale, key }) => `${locale}:${key}`, tIntegrations: ({ locale, key }) => `${locale}:${key}`,
    restartLabel: ({ locale }) => `${locale}:restart`, mcpServerHandleLabel: "host MCP", onTabChange: vi.fn(),
  } });
  const mounted = render(<Bound tabId="retired" />);
  expect(screen.getByText("fr:restart")).toBeTruthy();
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


test("media screen preserves the exact deep-link lookup and shares the live provider catalog with its tab count", () => {
  const linked = { id: "linked", workspaceId: "ws", title: "Linked", slug: "linked", alt: "", caption: "", credit: "",
    sha256: "sha", status: "active" as const, createdAt: "", updatedAt: "", version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null, contentType: "image/png", publicUrl: null };
  const useMediaItemLinkHook = vi.fn<MediaProps["hooks"]["useMediaItemLinkHook"]>(() => ({ notFound: false }));
  const useMediaHook = vi.fn<MediaProps["hooks"]["useMediaHook"]>(() => ({
    media: [], lookupMedia: [linked], editingItem: linked, editingId: "linked", setEditingId: vi.fn(),
    counts: { all: 41, images: 40, videos: 1, trash: 2 }, error: null, uploading: false,
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
    deps: { mediaProviderCatalogPort: port, VIEWER_TIME_ZONE: "UTC", MEDIA_GRID_SIZE_STORAGE_KEY: "host.media.cardSize",
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
