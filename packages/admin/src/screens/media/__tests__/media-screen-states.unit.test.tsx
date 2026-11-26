// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MediaLibraryPanel } from "../MediaLibraryPanel.js";
import { createMediaDictionary } from "../media-i18n/create-media-dictionary.js";
import { mediaFileName } from "../../../media/rules.js";

vi.mock("../MediaToolbar.js", () => ({ MediaToolbar: () => null, MediaOrderControls: () => null }));
vi.mock("../MediaEditChildren.js", () => ({ EditMediaModal: () => null }));
vi.mock("../MediaLightbox.js", () => ({ MediaLightbox: () => null }));
vi.mock("../MediaPurgeDialog.js", () => ({ MediaPurgeDialog: () => null }));
vi.mock("../MediaPreview.js", () => ({ MediaPreview: () => null }));

afterEach(cleanup);

const { t } = createMediaDictionary({ commonDictionary: {} });
const props = {
    activeTab: "trash", visibleMedia: [], mediaExpandHandles: ["media-item-legacy"], retentionDays: 30,
    error: null, conversionNotice: null, editingItem: null, editingId: null, rowSavingId: null,
    locale: "en", viewerTimeZone: "UTC", t: (key: string) => t({ locale: "en", key }),
    useMediaGridSizeHook: () => ["medium", vi.fn()],
    useMediaCardDetailsHook: () => ({ isPhone: false, openDetails: vi.fn() }),
    useMediaPreviewHook: () => ({ shape: null }), useMediaCardMetadataHook: () => ({}),
    deps: { MEDIA_GRID_SIZE_STORAGE_KEY: "grid", mediaTranslate: ({ key }: { key: string }) => key, mediaFileName },
    hooks: {},
    kit: {
      MediaLoadMore: () => null, RemoteImageImport: () => null,
      InfoTip: ({ icon }: { icon: ReactNode }) => icon,
      MiddleTruncate: ({ text }: { text: string }) => <span>{text}</span>,
      ServerLabel: ({ value }: { value: string }) => <span>{value}</span>,
      RowMenu: () => null, ChromePlaybackNote: () => null,
    },
} as unknown as Parameters<typeof MediaLibraryPanel>[0];

it("uses the host filename in the card title and phone details label", () => {
  const mediaFileName = vi.fn(() => "host-file.png");
  const item = { id: "one", title: "Original", status: "active", contentType: "image/png" } as Parameters<typeof MediaLibraryPanel>[0]["visibleMedia"][number];
  const { rerender } = render(<MediaLibraryPanel {...props} visibleMedia={[item]} deps={{ ...props.deps, mediaFileName }} />);
  expect(screen.getByText("host-file.png")).toBeTruthy();
  expect(mediaFileName).toHaveBeenCalledWith({ title: "Original", contentType: "image/png" });
  rerender(<MediaLibraryPanel {...props} visibleMedia={[item]} deps={{ ...props.deps, mediaFileName }}
    useMediaCardDetailsHook={() => ({ isPhone: true, openDetails: vi.fn() })} />);
  expect(screen.getByRole("button", { name: "Edit metadata: host-file.png" })).toBeTruthy();
});

it("an active tab hides countdowns while the previous Trash rows are still displayed", () => {
  const legacy = {
    id: "legacy", title: "Legacy", status: "trashed", contentType: "image/png", trashDaysRemaining: 44,
  } as Parameters<typeof MediaLibraryPanel>[0]["visibleMedia"][number] & { trashDaysRemaining: number };
  const { container, rerender } = render(<MediaLibraryPanel {...props} visibleMedia={[legacy]} />);
  expect(screen.getByText("44 days left")).toBeTruthy();
  rerender(<MediaLibraryPanel {...props} activeTab="images" visibleMedia={[legacy]} />);
  expect(screen.queryByText("44 days left")).toBeNull();
  expect(container.querySelectorAll(".media-card")).toHaveLength(1);
});

it("Media Trash explains retention and displays each supplied countdown", () => {
  const policy = "Items moved to Trash now are permanently deleted after 30 days. Items trashed earlier keep the date shown on their row.";
  const { rerender } = render(<MediaLibraryPanel {...props} />);
  expect(screen.getByText(policy)).toBeTruthy();
  expect(screen.getByText("Trash is empty.")).toBeTruthy();
  const legacy = {
    id: "legacy", title: "Legacy", status: "trashed", contentType: "image/png", trashDaysRemaining: 44,
  } as Parameters<typeof MediaLibraryPanel>[0]["visibleMedia"][number] & { trashDaysRemaining: number };
  rerender(<MediaLibraryPanel {...props} visibleMedia={[legacy]} />);
  expect(screen.getByText(policy)).toBeTruthy();
  expect(screen.getByText("44 days left")).toBeTruthy();
  rerender(<MediaLibraryPanel {...props} activeTab="images" visibleMedia={[{ ...legacy, status: "active" }]} />);
  expect(screen.queryByText(policy)).toBeNull();
  expect(screen.queryByText("44 days left")).toBeNull();
});
