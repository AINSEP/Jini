// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "../../../__tests__/fetch-query-support.js";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import { Lightbox } from "@jini-ai/ui/admin-widgets";
import { useFetchQuery, useFetchMutation } from "@jini-ai/ui/fetch-query";
import { TabBar } from "@jini-ai/ui/tab-strip";
import { ConfirmDialog } from "../../../react/components/ConfirmDialog/ConfirmDialog.js";
import { RowMenu } from "../../../react/components/RowMenu/RowMenu.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import { mediaFileName } from "../../../media/rules.js";
import { parseMediaHtmlAttributes } from "../../../media/html-attributes.js";
import { Media, type MediaProps } from "../Media.js";
import { MediaPreview } from "../MediaPreview.js";
import { useEditMediaModal } from "../hooks/use-edit-media-modal.hooks.js";
import { bindEditMediaPanel } from "../hooks/use-edit-media-panel.hooks.js";
import { createFakeMediaPort } from "../hooks/fake-media-port.js";
import { useMediaCardDetails } from "../hooks/use-media-card-details.hooks.js";
import { useMediaCardMetadata } from "../hooks/use-media-card-metadata.hooks.js";
import { useMediaPreview } from "../hooks/use-media-preview.hooks.js";
import type { MediaController } from "../hooks/use-media.hooks.js";
import type { MediaGridSize } from "../grid-size.js";

const t = (key: string) => key;
const noop = () => {};
const asyncNoop = async () => {};
const asset = (id: string, title: string, overrides: Partial<AdminMedia> = {}): AdminMedia => ({
  id, workspaceId: "ws", title, slug: id, alt: title, caption: "", credit: "", sha256: `hash-${id}`,
  status: "active", createdAt: "2026-10-02T00:30:00Z", updatedAt: "2026-10-02T00:30:00Z",
  version: 1, width: null, height: null, cssClass: null, htmlAttributes: null,
  contentType: "image/png", publicUrl: null, ...overrides,
});
const beach = asset("beach", "Beach", { byteSize: 2048 });
const archive = asset("archive", "Archive", { createdAt: "not-a-date", contentType: "application/octet-stream" });
const adminKit = fakeAdminKit();
const { Button: KitButton, TextField: KitTextField } = adminKit.components;
const kit: MediaProps["kit"] = {
  Button: (props) => <KitButton {...props} />, TextField: (props) => <KitTextField {...props} />, Dialog: adminKit.components.Dialog,
  Lightbox, RowMenu, ConfirmDialog, TabBar, Icon: adminKit.components.Icon,
  InfoTip: ({ label, icon }) => <span title={label}>{icon}</span>,
  MiddleTruncate: ({ text }) => <span>{text}</span>, ServerLabel: ({ value }) => <span>{value}</span>,
  EyeIcon: () => null, ExpandIcon: () => null, PlayIcon: () => null, PlaceholderIcon: () => null,
  UploadIcon: () => null, DockHeaderTip: ({ children }) => <>{children}</>, ChromePlaybackNote: () => null,
  MediaLoadMore: ({ hasMore, onLoadMore }) => hasMore ? <button onClick={onLoadMore}>Load more</button> : null,
  RemoteImageImport: () => null, PublishSectionButton: () => null, ExternalProvidersPanel: () => null,
};
const previewPort = { mediaOriginalUrl: (id: string) => `/original/${id}` };
const usePreview: MediaProps["hooks"]["useMediaPreviewHook"] = (item, translate) => useMediaPreview(item, { port: previewPort }, translate);
const deps: MediaProps["deps"] = {
  mediaFileName, VIEWER_TIME_ZONE: "UTC", MEDIA_GRID_SIZE_STORAGE_KEY: "media-size-spec",
  mediaTranslate: ({ key }) => key, VIDEO_CONVERSION_NOTICE_KEY: "Original saved without a web copy",
  mediaProviderCatalogPort: { fetchMediaProviderCatalog: async () => null },
  defaultMediaImportPort: { importFromUrl: async () => ({ media: null }), listKey: ["media"] },
  describeApiError: ({ fallback }) => fallback,
};

function setup(overrides: Partial<MediaController> = {}, hookOverrides: Partial<MediaProps["hooks"]> = {}) {
  const useMediaHook: MediaProps["hooks"]["useMediaHook"] = () => {
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [pendingPurge, setPendingPurge] = useState<AdminMedia | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [orderBy, setOrderBy] = useState<MediaController["orderBy"]>("created");
    const [altDraft, setAltDraft] = useState("");
    const [uploadOpen, setUploadOpen] = useState(false);
    const [selectedFileName, setSelectedFileName] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);
    return {
      media: [], lookupMedia: [], editingItem: overrides.media?.find(({ id }) => id === editingId) ?? null,
      editingId, setEditingId,
      counts: { all: 41, images: 12, videos: 29, trash: 0 }, retentionDays: null, error: null, uploading: false,
      uploadOpen, openUpload: () => setUploadOpen(true), closeUpload: () => setUploadOpen(false),
      uploadError: null, conversionNotice: null, canUpload: !!selectedFileName && !overrides.uploading, altDraft, setAltDraft,
      fileInputRef, selectedFileName, upload: asyncNoop,
      hasUntypedActive: false, hasMore: false, loadingMore: false, loadMoreError: null, loadMore: asyncNoop,
      toggleEditing: (item) => setEditingId((id) => id === item.id ? null : item.id),
      onMetadataSaved: () => setEditingId(null), trash: asyncNoop, restore: asyncNoop, pendingPurge, setPendingPurge,
      rowSavingId: null, purge: asyncNoop, lightboxIndex, setLightboxIndex, orderBy, setOrderBy, t, locale: "en",
      ...overrides,
      onFileChange: (event) => {
        setSelectedFileName(event.currentTarget.files?.[0]?.name ?? "");
        overrides.onFileChange?.(event);
      },
    };
  };
  const hooks: MediaProps["hooks"] = {
    useMediaHook, useMediaItemLinkHook: () => ({ notFound: false }), useMediaProviderCatalogHook: () => null,
    useMediaTabsHook: (tab) => ({ activeTab: tab === "images" || tab === "videos" || tab === "trash" ? tab : "all", setActiveTab: noop }),
    useMediaPreviewHook: usePreview, useMediaCardMetadataHook: useMediaCardMetadata, useMediaCardDetailsHook: useMediaCardDetails,
    useMediaGridSizeHook: () => useState<MediaGridSize>("medium"), useEditMediaModalHook: useEditMediaModal,
    useAdminKitValuesHook: () => adminKit.values,
    useAdminThemeBoundaryHook: () => ({ "data-theme": "light" }),
    useEditMediaPanelHook: () => { throw new Error("No editor is open in this harness"); },
    useRemoteImageImport: () => { throw new Error("No remote import is open in this harness"); },
    useFetchMutation: adminKit.query.useFetchMutation, ...hookOverrides,
  };
  const view = (props: Partial<MediaProps> = {}) => (
    <Media kit={kit} deps={deps} hooks={hooks} {...props} />
  );
  return { view };
}

it.each([
  ["all", "No media uploaded yet.", "Use Upload image above to add your first file."],
  ["images", "No images yet.", "Uploaded images appear here once you add them."],
  ["videos", "No videos yet.", "Uploaded videos appear here once you add them."],
  ["trash", "Trash is empty.", "Media you trash appears here."],
] as const)("shows the %s tab's own empty guidance", (tabId, title, help) => {
  const { view } = setup();
  render(view({ tabId }));
  expect(screen.getByText(title)).toBeVisible();
  expect(screen.getByText(help)).toBeVisible();
});

it("preserves server counts while showing exact-item, untyped-asset and conversion notices only when relevant", () => {
  const { view } = setup(
    { hasUntypedActive: true, conversionNotice: "web-copy-unavailable" },
    { useMediaItemLinkHook: ({ itemId }) => ({ notFound: itemId === "missing" }) },
  );
  const { rerender } = render(view({ tabId: "images", itemId: "missing" }));
  expect(screen.getByRole("heading", { name: "Media" })).toBeVisible();
  expect(screen.getByRole("tab", { name: /Images.*12/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("That media item wasn't found.")).toBeVisible();
  expect(screen.getByText("You can find them on the All tab.", { exact: false })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Original saved without a web copy");
  rerender(view({ tabId: "all", itemId: null }));
  expect(screen.queryByText("That media item wasn't found.")).toBeNull();
  expect(screen.queryByText("You can find them on the All tab.", { exact: false })).toBeNull();
});

it("delivers Load more and updates order and card size from labelled controls", async () => {
  const user = userEvent.setup();
  const loadMore = vi.fn(async () => {});
  const { view } = setup({ media: [beach], hasMore: true, loadMore });
  render(view());
  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(loadMore.mock.calls).toEqual([[]]);
  const order = screen.getByRole("combobox", { name: "Order by" });
  const size = screen.getByRole("combobox", { name: "Size" });
  expect(order).toHaveValue("created");
  expect(size).toHaveValue("medium");
  await user.selectOptions(order, "alphabetical");
  await user.selectOptions(size, "xl");
  expect(order).toHaveValue("alphabetical");
  expect(size).toHaveValue("xl");
  expect(screen.getByRole("img", { name: "Beach" }).closest(".media-grid")).toHaveAttribute("data-size", "xl");
});

it("opens the selected asset, resets a failed preview on Next, and closes the enlarged view", async () => {
  const user = userEvent.setup();
  const { view } = setup({ media: [archive, beach] });
  render(view());
  const expand = screen.getByRole("button", { name: 'View "Archive" larger' });
  expect(expand).toHaveAttribute("data-agent-element", "media-item-archive-expand");
  await user.click(expand);
  const dialog = screen.getByRole("dialog", { name: "Archive" });
  fireEvent.error(within(dialog).getByRole("img", { name: "Archive" }));
  const player = within(dialog).getByLabelText("Archive");
  expect(player).toHaveAttribute("controls");
  fireEvent.error(player);
  expect(within(dialog).getByRole("link", { name: "Download original" })).toHaveAttribute("href", "/original/archive");
  await user.click(within(dialog).getByRole("button", { name: "Next asset" }));
  expect(screen.getByRole("dialog", { name: "Beach" })).toBe(dialog);
  expect(within(dialog).getByRole("img", { name: "Beach" })).toHaveAttribute("src", "/original/beach");
  expect(within(dialog).queryByRole("link", { name: "Download original" })).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Beach" })).toBeNull();
});

it("renders loaded shape, bytes and the viewer-local upload date, but no metadata row when all are missing", () => {
  const { view } = setup({ media: [archive, beach] });
  render(view({ viewerTimeZone: "America/Los_Angeles" }));
  const beachImage = screen.getByRole("img", { name: "Beach" });
  const beachCard = beachImage.closest(".media-card")!;
  const archiveCard = screen.getByRole("img", { name: "Archive" }).closest(".media-card")!;
  expect(archiveCard.querySelector(".media-card-size")).toBeNull();
  expect(within(beachCard as HTMLElement).getByText("2 KB")).toBeVisible();
  expect(within(beachCard as HTMLElement).getByText("Oct 1, 2026")).toHaveAttribute("datetime", "2026-10-02T00:30:00Z");
  Object.defineProperties(beachImage, { naturalWidth: { value: 100 }, naturalHeight: { value: 400 } });
  fireEvent.load(beachImage);
  expect(within(beachCard as HTMLElement).getByText("Long image")).toBeVisible();
  expect(within(beachCard as HTMLElement).getByText("100×400").closest(".media-card-specs"))
    .toHaveTextContent("Long image · 100×400 · 2 KB");
  expect(beachImage).toHaveClass("media-card-media--long");
});

it("targets purge to the named trashed asset and clears the confirmation on Cancel", async () => {
  const user = userEvent.setup();
  const trashed = { ...beach, status: "trashed" as const, trashDaysRemaining: 17 };
  const purge = vi.fn(async () => {});
  const restore = vi.fn(async (_item: AdminMedia) => {});
  const { view } = setup({ media: [trashed], purge, restore, rowSavingId: archive.id });
  render(view({ tabId: "trash" }));
  expect(screen.getByText("17 days left")).toBeVisible();
  expect(screen.queryByRole("dialog", { name: "Delete permanently?" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Restore: Beach" }));
  expect(restore.mock.calls).toEqual([[trashed]]);
  const openPurge = async () => {
    await user.click(screen.getByRole("button", { name: 'Actions for "Beach"' }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete permanently" }));
    return screen.getByRole("dialog", { name: "Delete permanently?" });
  };
  const dialog = await openPurge();
  expect(within(dialog).getByText('Permanently delete "Beach"? This cannot be undone.')).toBeVisible();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Delete permanently?" })).toBeNull();
  expect(purge.mock.calls).toEqual([]);
  await user.click(within(await openPurge()).getByRole("button", { name: "Delete permanently" }));
  expect(purge.mock.calls).toEqual([[]]);
});

it("disables only the row being purged while its confirmation is pending", () => {
  const trashed = { ...beach, status: "trashed" as const };
  const { view } = setup({ media: [trashed], pendingPurge: trashed, rowSavingId: trashed.id });
  render(view({ tabId: "trash" }));
  const dialog = screen.getByRole("dialog", { name: "Delete permanently?" });
  expect(within(dialog).getByRole("button", { name: "Delete permanently" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Restore: Beach" })).toBeDisabled();
  expect(screen.queryByText(/permanently deleted after/)).toBeNull();
});

it("uses an advisory video picker, edits alt text and submits the chosen file", async () => {
  const user = userEvent.setup();
  const file = new File(["webm"], "tour.webm", { type: "video/webm" });
  const upload = vi.fn(async (event?: Pick<React.FormEvent, "preventDefault">) => { event?.preventDefault(); });
  const onFileChange = vi.fn((event: React.ChangeEvent<HTMLInputElement>) => event.currentTarget.files?.[0]);
  const { view } = setup({ onFileChange, upload, uploadError: "Previous upload failed" });
  render(view({ tabId: "videos" }));
  await user.click(screen.getByRole("button", { name: "Upload video" }));
  const dialog = within(screen.getByRole("dialog", { name: "Upload video" }));
  const input = dialog.getByLabelText("File to upload");
  expect(input).toHaveAttribute("accept", "video/mp4,video/webm,.mov,.m4v,video/quicktime,video/x-m4v");
  expect(dialog.getByText("No file chosen")).toBeVisible();
  expect(dialog.getByRole("button", { name: "Upload" })).toBeDisabled();
  await user.upload(input, file);
  expect(onFileChange.mock.results).toEqual([{ type: "return", value: file }]);
  expect(dialog.getByText("tour.webm")).toBeVisible();
  expect(dialog.getByRole("alert")).toHaveTextContent("Previous upload failed");
  const alt = dialog.getByRole("textbox", { name: "Alt text (optional)" });
  await user.type(alt, "Walking tour");
  expect(alt).toHaveValue("Walking tour");
  await user.click(dialog.getByRole("button", { name: "Upload" }));
  expect(upload).toHaveBeenCalledTimes(1);
  await user.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Upload video" })).toBeNull();
});

it("locks the chooser and action buttons while uploading and does not show a stale upload error", () => {
  const { view } = setup({ uploadOpen: true, uploading: true });
  render(view());
  const dialog = within(screen.getByRole("dialog", { name: "Upload image or video" }));
  expect(dialog.getByText("No file chosen")).toBeVisible();
  expect(dialog.getByLabelText("File to upload")).toBeDisabled();
  expect(dialog.getByRole("textbox", { name: "Alt text (optional)" })).toBeDisabled();
  expect(dialog.getByRole("button", { name: "Uploading…" })).toBeDisabled();
  expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(dialog.queryByRole("alert")).toBeNull();
});

it("opens a muted video still, keeps Edit separate, and preserves both edit and download when neither decoder succeeds", async () => {
  const user = userEvent.setup();
  const onExpand = vi.fn();
  const onEdit = vi.fn();
  render(<MediaPreview kit={kit} item={archive} t={t} useMediaPreviewHook={usePreview}
    onExpand={onExpand} edit={{ onEdit, agentHandle: "archive-edit" }} />);
  const image = screen.getByRole("img", { name: "Archive" });
  Object.defineProperties(image, { naturalWidth: { value: 100, configurable: true }, naturalHeight: { value: 100 } });
  fireEvent.load(image);
  expect(image.parentElement?.querySelector(".media-card-backdrop")).toHaveAttribute("src", "/original/archive");
  Object.defineProperty(image, "naturalWidth", { value: 180 });
  fireEvent.load(image);
  expect(image).toHaveClass("media-card-media--fill");
  expect(image.parentElement?.querySelector(".media-card-backdrop")).toBeNull();
  fireEvent.error(image);
  const open = screen.getByRole("button", { name: 'View "Archive" larger' });
  const video = within(open).getByLabelText("Archive") as HTMLVideoElement;
  expect(video.controls).toBe(false);
  expect(video.muted).toBe(true);
  expect(open.querySelector(".media-card-backdrop")).toBeNull();
  Object.defineProperties(video, { videoWidth: { value: 160 }, videoHeight: { value: 90 }, duration: { value: 8 } });
  fireEvent.loadedMetadata(video);
  expect(video).toHaveClass("media-card-media--fill");
  await user.click(open);
  expect(onExpand).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "click" }));
  fireEvent.error(video);
  expect(screen.queryByRole("button", { name: 'View "Archive" larger' })).toBeNull();
  expect(screen.getByRole("link", { name: "Download original" })).toHaveAttribute("href", "/original/archive");
  await user.click(screen.getByRole("button", { name: 'Edit "Archive"' }));
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "click" }));
  expect(onExpand).toHaveBeenCalledTimes(1);
});

it("reports initial loading failure separately from a stale error alongside usable rows", () => {
  const loading = setup({ media: null });
  const failed = setup({ media: null, error: "Media service unavailable" });
  const stale = setup({ media: [beach], error: "Could not refresh library" });
  const { rerender } = render(loading.view());
  expect(screen.getByText("Loading media…")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Media" })).toBeNull();
  rerender(failed.view());
  expect(screen.getByText("Media service unavailable")).toBeVisible();
  expect(screen.queryByText("Loading media…")).toBeNull();
  rerender(stale.view());
  expect(screen.getByRole("heading", { name: "Media" })).toBeVisible();
  expect(screen.getByText("Could not refresh library")).toBeVisible();
  expect(screen.getByRole("img", { name: "Beach" })).toHaveAttribute("src", "/original/beach");
});

it("opens metadata for the phone card title and shows duration only after nonzero video dimensions are available", async () => {
  const user = userEvent.setup();
  const toggleEditing = vi.fn();
  const clip = asset("clip", "Clip", { contentType: "video/webm" });
  const { view } = setup({ media: [clip], toggleEditing }, {
    useMediaCardDetailsHook: ({ onToggleEdit }) => ({ isPhone: true, openDetails: onToggleEdit }),
  });
  render(view({ tabId: "videos" }));
  await user.click(screen.getByRole("button", { name: "Edit metadata: Clip.webm" }));
  expect(toggleEditing.mock.calls).toEqual([[clip]]);
  const image = screen.getByRole("img", { name: "Clip" });
  Object.defineProperties(image, { naturalWidth: { value: 0, configurable: true }, naturalHeight: { value: 80, configurable: true } });
  fireEvent.load(image);
  expect(screen.queryByText("0×80")).toBeNull();
  Object.defineProperties(image, { naturalWidth: { value: 80 }, naturalHeight: { value: 0 } });
  fireEvent.load(image);
  expect(screen.queryByText("80×0")).toBeNull();
  fireEvent.error(image);
  const video = screen.getByLabelText("Clip");
  Object.defineProperties(video, {
    videoWidth: { value: 1920, configurable: true }, videoHeight: { value: 0, configurable: true }, duration: { value: 65 },
  });
  fireEvent.loadedMetadata(video);
  expect(screen.queryByText("1:05")).toBeNull();
  Object.defineProperties(video, { videoWidth: { value: 0 }, videoHeight: { value: 1080 } });
  fireEvent.loadedMetadata(video);
  expect(screen.queryByText("1:05")).toBeNull();
  Object.defineProperty(video, "videoWidth", { value: 1920 });
  fireEvent.loadedMetadata(video);
  expect(screen.getByText("1:05")).toBeVisible();
  expect(screen.getByText("16:9 · 1920×1080")).toBeVisible();
});

it("opens the card editor, closes on Cancel without saving, and closes after a save only for the edited item", async () => {
  const user = userEvent.setup();
  const port = createFakeMediaPort({ media: [archive, beach] });
  const useEditMediaPanelHook = bindEditMediaPanel({
    hooks: { useFetchQuery, useFetchMutation, useLocaleHook: () => "en" },
    deps: {
      port, translate: ({ key }) => key, describeApiError: ({ fallback }) => fallback,
      embedMarkerSnippet: ({ value }) => `media:${value}`, parseMediaHtmlAttributes,
      embedPolicy: { allowedAttributeNames: [], isAllowedAttributeName: () => false,
        parseAttributes: () => ({ attributes: {}, errors: [], error: null }) },
      writeText: asyncNoop, setTimeout: globalThis.setTimeout,
    },
  });
  const { view } = setup({ media: [archive, beach] }, { useEditMediaPanelHook });
  render(view());
  await user.click(screen.getByRole("button", { name: 'Edit "Archive"' }));
  const archiveEditor = screen.getByRole("dialog", { name: 'Editing "Archive"' });
  await user.type(within(archiveEditor).getByRole("textbox", { name: "Title" }), " draft");
  await user.click(within(archiveEditor).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: 'Editing "Archive"' })).toBeNull();

  await user.click(screen.getByRole("button", { name: 'Edit "Beach"' }));
  const beachEditor = screen.getByRole("dialog", { name: 'Editing "Beach"' });
  await user.type(within(beachEditor).getByRole("textbox", { name: "Title" }), " at dawn");
  await user.click(within(beachEditor).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: 'Editing "Beach"' })).toBeNull());
  expect((await port.listMedia()).media.map(({ id, title }) => [id, title])).toEqual([["archive", "Archive"], ["beach", "Beach at dawn"]]);
});
