import { describe, expect, it, vi } from "vitest";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import {
  describeMediaHtmlAttributeError, filterMediaByTab, findEditingItem, hasUntypedMedia, mediaAltText,
  mediaContentTabCounts, mediaFillsPreview, mediaRowMenuItems, mediaShapeBadges, mediaUploadAccept,
  mediaUploadLabel, parseOptionalPixelSize, readFileAsBase64, resolveLightboxItem, showsUntypedMediaNote,
  sortMediaByOrder, visibleMediaError, type Base64FileReader,
} from "../rules.js";

/** The rules take the host's translator and error describer as arguments; these fakes prove that is the only seam. */
const translate = ({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`;

describe("media rules injected collaborators", () => {
  it("describes an HTML-attribute error through the supplied translator", () => {
    const text = describeMediaHtmlAttributeError({ error: { reason: "event-handler", attribute: "onerror" }, locale: "fr", translate });
    expect(text).toContain("fr:");
    expect(text).toContain("onerror");
  });

  it("builds the row menu labels through the supplied translator", () => {
    const item = { id: "m1", status: "published" } as unknown as AdminMedia;
    const handlers = { onToggleEdit: vi.fn(), onTrash: vi.fn(), onRequestPurge: vi.fn() };
    const items = mediaRowMenuItems({ item, editingId: null, handlers, locale: "de", translate });
    expect(items.map((entry) => entry.label)).toEqual(["de:Edit metadata", "de:Trash"]);
  });

  it("surfaces list failures through the supplied describer and prefers trash errors", () => {
    const describeApiError = vi.fn(({ e, fallback }: { e: unknown; fallback: string }) => `${fallback}/${(e as Error).message}`);
    const base = { trashError: null, purgeError: null, deleteFallback: "del", restoreError: null, restoreFallback: "res", listError: new Error("L"), listFallback: "list", hasMedia: false, describeApiError };
    expect(visibleMediaError(base)).toBe("list/L");
    expect(visibleMediaError({ ...base, trashError: new Error("T") })).toBe("del/T");
    expect(visibleMediaError({ ...base, hasMedia: true })).toBeNull();
  });
});

describe("mediaUploadAccept (native picker)", () => {
  // The server accepts .mov/.m4v (Jini cms sniff + upload), but the picker's `accept` only listed MP4/WebM,
  // so an iPhone .MOV was greyed out in the OS file dialog. Extensions are listed too because some
  // platforms report .mov with no MIME type at all.
  const QUICKTIME_TOKENS = [".mov", ".m4v", "video/quicktime", "video/x-m4v"];

  it.each(["videos", "all"] as const)("the %s tab's picker lists the .mov/.m4v tokens", (tab) => {
    const tokens = mediaUploadAccept({ tab }).split(",");
    for (const token of QUICKTIME_TOKENS) expect(tokens).toContain(token);
  });

  it("the images tab stays image-only", () => {
    expect(mediaUploadAccept({ tab: "images" })).not.toMatch(/video|\.mov|\.m4v/);
  });
});

const asset = (id: string, overrides: Partial<AdminMedia> = {}): AdminMedia => ({
  id, workspaceId: "ws", title: id, slug: id, alt: "", caption: "", credit: "", sha256: `sha-${id}`,
  status: "active", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  version: 1, width: null, height: null, cssClass: null, htmlAttributes: null, contentType: "image/png",
  publicUrl: null, ...overrides,
});

it.each([
  { reason: "event-handler", attribute: "onclick", message: "Event handler attributes like 'onclick' are not allowed." },
  { reason: "unsafe-url", attribute: "href", message: "'href' cannot use a javascript: value." },
  { reason: "unsafe-style", attribute: "style", message: "'style' cannot use an unsafe style value." },
  { reason: "malformed", attribute: "data-$&", message: "Could not parse HTML attributes near 'data-$&'." },
  { reason: "disallowed-name", attribute: "data-test", message: "'data-test' is not an allowed HTML attribute." },
] as const)("localizes the specific $reason hint and preserves its literal attribute", ({ reason, attribute, message }) => {
  expect(describeMediaHtmlAttributeError({ error: { reason, attribute }, locale: "fr", translate })).toBe(`fr:${message}`);
});

it.each([
  { raw: "", expected: null },
  { raw: "  ", expected: null },
  { raw: " 540 ", expected: 540 },
])("uses native sizing only for blank pixel input %j", ({ raw, expected }) => {
  expect(parseOptionalPixelSize({ value: raw })).toBe(expected);
});

function readerFor(result: Base64FileReader["result"], error?: Error): Base64FileReader {
  return {
    result, error, onerror: null, onload: null,
    readAsDataURL() {
      if (error) this.onerror?.();
      else this.onload?.();
    },
  };
}

it.each([
  { result: "data:image/png;base64,b2s=", expected: "b2s=" },
  { result: "b2s=", expected: "b2s=" },
  { result: null, expected: "" },
])("reads a base64 payload from browser result %j", async ({ result, expected }) => {
  const file = new File(["ok"], "cover.png", { type: "image/png" });
  const reader = readerFor(result);
  const read = vi.spyOn(reader, "readAsDataURL");
  await expect(readFileAsBase64({ file }, { createReader: () => reader })).resolves.toBe(expected);
  expect(read.mock.calls).toEqual([[file]]);
});

it("rejects the browser's file error, with a specific fallback when the browser supplies none", async () => {
  const file = new File(["ok"], "cover.png");
  const denied = new Error("File no longer readable");
  await expect(readFileAsBase64({ file }, { createReader: () => readerFor(null, denied) })).rejects.toBe(denied);
  const reader = readerFor(null);
  reader.readAsDataURL = function () { this.onerror?.(); };
  await expect(readFileAsBase64({ file }, { createReader: () => reader })).rejects.toThrow("failed to read file");
});

it("counts and filters asset families without double-counting Trash or treating missing types as unknown formats", () => {
  const media = [
    asset("clip", { contentType: "video/x-m4v" }), asset("missing", { contentType: null }),
    asset("vector", { contentType: "image/svg+xml" }), asset("opaque", { contentType: "application/octet-stream" }),
    asset("deleted", { status: "trashed", contentType: "video/mp4" }),
  ];
  expect(filterMediaByTab({ media, tab: "all" }).map(({ id }) => id)).toEqual(["clip", "missing", "vector", "opaque"]);
  expect(filterMediaByTab({ media, tab: "images" }).map(({ id }) => id)).toEqual(["vector"]);
  expect(filterMediaByTab({ media, tab: "videos" }).map(({ id }) => id)).toEqual(["clip"]);
  expect(filterMediaByTab({ media, tab: "trash" }).map(({ id }) => id)).toEqual(["deleted"]);
  expect(mediaContentTabCounts({ media })).toEqual({ all: 4, images: 1, videos: 1, trash: 1 });
  expect(mediaContentTabCounts({ media: [] })).toEqual({ all: 0, images: 0, videos: 0, trash: 0 });
  expect(mediaContentTabCounts({ media: null })).toEqual({});
});

it("warns about genuinely untyped active rows only on tabs that hide them", () => {
  const opaque = asset("opaque", { contentType: "application/octet-stream" });
  const trashed = asset("deleted", { status: "trashed", contentType: null });
  const untyped = asset("missing", { contentType: null });
  expect(hasUntypedMedia({ media: [opaque] })).toBe(false);
  expect(showsUntypedMediaNote({ media: [opaque, trashed], tab: "images" })).toBe(false);
  expect(showsUntypedMediaNote({ media: [opaque, trashed, untyped], tab: "images" })).toBe(true);
  expect(showsUntypedMediaNote({ media: [opaque, untyped], tab: "videos" })).toBe(true);
  expect(showsUntypedMediaNote({ media: [untyped], tab: "all" })).toBe(false);
  expect(showsUntypedMediaNote({ media: [trashed], tab: "trash" })).toBe(false);
});

it("sorts by trimmed case-insensitive title or newest timestamp with opposing stable ID tie-breaks", () => {
  const media = [
    asset("older", { title: "Lemon", createdAt: "2026-09-01T00:00:00Z" }),
    asset("b", { title: "  apple ", createdAt: "2026-10-03T00:00:00Z" }),
    asset("a", { title: "APPLE", createdAt: "2026-10-03T00:00:00Z" }),
    asset("blank", { title: "", createdAt: "2026-10-06T00:00:00Z" }),
  ];
  expect(sortMediaByOrder({ media, orderBy: "alphabetical" }).map(({ id }) => id)).toEqual(["blank", "a", "b", "older"]);
  expect(sortMediaByOrder({ media, orderBy: "created" }).map(({ id }) => id)).toEqual(["blank", "b", "a", "older"]);
  expect(media.map(({ id }) => id)).toEqual(["older", "b", "a", "blank"]);
});

it("provides accessible fallbacks without substituting title for authored alt", () => {
  expect(mediaAltText({ item: asset("one", { alt: "A lighthouse" }), untitledAsset: "Untitled" })).toBe("A lighthouse");
  expect(mediaAltText({ item: asset("one", { title: "Harbor" }), untitledAsset: "Untitled" })).toBe("Harbor");
  expect(mediaAltText({ item: asset("one", { title: "" }), untitledAsset: "Untitled" })).toBe("Untitled");
});

it.each([
  ["images", "Upload image"], ["videos", "Upload video"],
  ["all", "Upload image or video"], ["trash", "Upload image or video"],
] as const)("labels %s uploads with the supported family", (tab, label) => {
  expect(mediaUploadLabel({ tab })).toBe(label);
});

it.each([
  { width: 124, fill: false }, { width: 125, fill: true }, { width: 200, fill: true }, { width: 201, fill: false },
])("fills the preview only within its intended landscape bounds ($width:100)", ({ width, fill }) => {
  expect(mediaFillsPreview({ width, height: 100 })).toBe(fill);
});

it("distinguishes long images from videos and rounds video duration before formatting", () => {
  expect(mediaShapeBadges({ width: 1080, height: 1920, duration: 64.7 }))
    .toEqual({ size: "9:16 · 1080×1920", duration: "1:05", isLong: false });
  expect(mediaShapeBadges({ width: 100, height: 301 })).toEqual({ size: "100×301", duration: null, isLong: true });
  expect(mediaShapeBadges({ width: 100, height: 300 })).toEqual({ size: "100×300", duration: null, isLong: false });
  expect(mediaShapeBadges({ width: 100, height: 301, duration: 0 })).toEqual({ size: "100×301", duration: "0:00", isLong: false });
});

it("keeps purge and restore errors distinct, ahead of background list failures", () => {
  const describeApiError = ({ e, fallback }: { e: unknown; fallback: string }) => `${fallback}: ${String(e)}`;
  const base = {
    trashError: null, purgeError: null, restoreError: null, listError: new Error("offline"),
    deleteFallback: "delete failed", restoreFallback: "restore failed", listFallback: "load failed",
    hasMedia: true, describeApiError,
  };
  expect(visibleMediaError({ ...base, purgeError: new Error("busy"), restoreError: new Error("locked") })).toBe("delete failed: Error: busy");
  expect(visibleMediaError({ ...base, restoreError: new Error("locked") })).toBe("restore failed: Error: locked");
  expect(visibleMediaError({ ...base, hasMedia: false, listError: null })).toBeNull();
});

it("delivers edit and the status-appropriate destructive action for the same selected row", () => {
  const handlers = { onToggleEdit: vi.fn(), onTrash: vi.fn(), onRequestPurge: vi.fn() };
  const archived = asset("archived", { status: "trashed" });
  const active = asset("active");
  const trashMenu = mediaRowMenuItems({ item: archived, editingId: "archived", handlers, locale: "en", translate });
  expect(trashMenu.map(({ key, label }) => [key, label])).toEqual([["edit", "en:Close editing"], ["purge", "en:Delete permanently"]]);
  expect(trashMenu.find(({ key }) => key === "purge")?.destructive).toBe(true);
  trashMenu.find(({ key }) => key === "edit")?.onSelect?.();
  trashMenu.find(({ key }) => key === "purge")?.onSelect?.();
  const activeMenu = mediaRowMenuItems({ item: active, editingId: "archived", handlers, locale: "en", translate });
  activeMenu.find(({ key }) => key === "trash")?.onSelect?.();
  expect(handlers.onToggleEdit.mock.calls).toEqual([[archived]]);
  expect(handlers.onRequestPurge.mock.calls).toEqual([[archived]]);
  expect(handlers.onTrash.mock.calls).toEqual([[active]]);
});

it("resolves editors by ID, lightboxes by index and closes either when the row is missing", () => {
  const one = asset("one");
  const two = asset("two");
  const media = [one, two];
  expect(findEditingItem({ media, editingId: "two" })).toBe(two);
  expect(findEditingItem({ media, editingId: "missing" })).toBeNull();
  expect(findEditingItem({ media: null, editingId: "two" })).toBeNull();
  expect(resolveLightboxItem({ items: media, activeIndex: 0 })).toBe(one);
  expect(resolveLightboxItem({ items: media, activeIndex: 2 })).toBeNull();
  expect(resolveLightboxItem({ items: media, activeIndex: null })).toBeNull();
});
