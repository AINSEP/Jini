import { expect, it, vi } from "vitest";
import { createRenditionAccess } from "../rendition-access.js";
import type { PostRecord } from "../../../posts/post.js";
import type { MediaRecord } from "../../types.js";

it("gates current and retired aliases and does not turn unreadable gated entries into public evidence", async () => {
  const record = { id: "id", slug: "new", source: {}, kind: "image" } as unknown as MediaRecord;
  const entry: PostRecord = { id: "p", workspaceId: "w", title: "", slug: "p", kind: "post", bodyFormat: "html", bodyHtml: `<img data-embed-config='{"type":"media","id":"old"}'>`, bodyJson: {}, status: "published", memberAccessJson: "members", updatedAt: "now", version: 1 };
  const readEntitlement = vi.fn(async () => () => false);
  const input = { workspaceId: "w", cache: new Map(), nowMs: () => 0, readEntries: async () => [entry], readWidgetRows: undefined, findMedia: async () => record, readRetiredSlugs: async () => ["old"], isGated: ({ entry }: { entry: { memberAccessJson?: string | null } }) => entry.memberAccessJson === "members" };
  const access = createRenditionAccess(input);
  for (const idOrSlug of ["id", "new", "old"]) expect(await access.decide({ idOrSlug, readEntitlement })).toEqual({ gated: true, allowed: false, record });
  const unreadable = { ...entry, bodyHtml: null, bodyFormat: "future" } as unknown as PostRecord;
  expect(await createRenditionAccess({ ...input, cache: new Map(), readEntries: async () => [unreadable] }).decide({ idOrSlug: "id", readEntitlement })).toEqual({ gated: true, allowed: false, record });
  const publicEntry = { ...entry, memberAccessJson: null };
  expect(await createRenditionAccess({ ...input, cache: new Map(), readEntries: async () => [unreadable, publicEntry] }).decide({ idOrSlug: "id", readEntitlement })).toEqual({ gated: false, allowed: true, record });
});

it("failed reference-index reads are retried and an unreferenced asset does not consult entitlement", async () => {
  const workspaceId = "west";
  const record: MediaRecord = { id: "asset", slug: "photo", title: "Photo", workspaceId, status: "active", source: { sha256: "a".repeat(64) },
    alt: "", caption: "", credit: "", createdAt: "2026-11-19", updatedAt: "2026-11-19", version: 1,
    width: null, height: null, cssClass: null, htmlAttributes: null };
  const failure = new Error("posts DB unavailable");
  const readEntries = vi.fn<Parameters<typeof createRenditionAccess>[0]["readEntries"]>().mockRejectedValueOnce(failure).mockResolvedValue([]);
  const readRetiredSlugs = vi.fn<Parameters<typeof createRenditionAccess>[0]["readRetiredSlugs"]>(async () => []);
  const readEntitlement = vi.fn(async () => () => false);
  const access = createRenditionAccess({ workspaceId, cache: new Map(), nowMs: () => 0, readEntries, readWidgetRows: undefined,
    findMedia: async ({ idOrSlug }) => idOrSlug === "asset" ? record : null, readRetiredSlugs, isGated: () => false });
  await expect(access.decide({ idOrSlug: "asset", readEntitlement })).rejects.toBe(failure);
  expect(await access.decide({ idOrSlug: "asset", readEntitlement })).toEqual({ gated: false, allowed: true, record });
  expect(await access.decide({ idOrSlug: "not-in-library", readEntitlement })).toEqual({ gated: false, allowed: true, record: null });
  expect(readEntries.mock.calls).toEqual([[{ workspaceId }], [{ workspaceId }]]);
  expect(readRetiredSlugs.mock.calls).toEqual([[{ workspaceId, mediaId: "asset" }], [{ workspaceId, mediaId: "asset" }]]);
  expect(readEntitlement.mock.calls).toEqual([]);
});
