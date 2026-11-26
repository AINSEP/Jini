// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MediaLibraryPanel } from "../MediaLibraryPanel.js";
import { createMediaDictionary } from "../media-i18n/create-media-dictionary.js";

vi.mock("../MediaToolbar.js", () => ({ MediaToolbar: () => null, MediaOrderControls: () => null }));
vi.mock("../MediaEditChildren.js", () => ({ EditMediaModal: () => null }));
vi.mock("../MediaLightbox.js", () => ({ MediaLightbox: () => null }));
vi.mock("../MediaPurgeDialog.js", () => ({ MediaPurgeDialog: () => null }));
vi.mock("../MediaPreview.js", () => ({ MediaPreview: () => null }));

afterEach(cleanup);

it("Media Trash explains retention and displays each supplied countdown", () => {
  const { t } = createMediaDictionary({ commonDictionary: {} });
  const props = {
    activeTab: "trash", visibleMedia: [], mediaExpandHandles: ["media-item-legacy"], retentionDays: 30,
    error: null, conversionNotice: null, editingItem: null, editingId: null, rowSavingId: null,
    locale: "en", viewerTimeZone: "UTC", t: (key: string) => t({ locale: "en", key }),
    useMediaGridSizeHook: () => ["medium", vi.fn()],
    useMediaCardDetailsHook: () => ({ isPhone: false, openDetails: vi.fn() }),
    useMediaPreviewHook: () => ({ shape: null }), useMediaCardMetadataHook: () => ({}),
    deps: { MEDIA_GRID_SIZE_STORAGE_KEY: "grid", mediaTranslate: ({ key }: { key: string }) => key },
    hooks: {},
    kit: {
      MediaLoadMore: () => null, RemoteImageImport: () => null,
      InfoTip: ({ icon }: { icon: ReactNode }) => icon,
      MiddleTruncate: ({ text }: { text: string }) => <span>{text}</span>,
      ServerLabel: ({ value }: { value: string }) => <span>{value}</span>,
      RowMenu: () => null, ChromePlaybackNote: () => null,
    },
  } as unknown as Parameters<typeof MediaLibraryPanel>[0];
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
