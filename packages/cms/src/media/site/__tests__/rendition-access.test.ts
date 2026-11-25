import { expect, it, vi } from "vitest";
import { createRenditionAccess } from "../rendition-access.js";
import type { PostRecord } from "../../../posts/post.js";
import type { MediaRecord } from "../../types.js";

it("gates current and retired aliases and does not turn unreadable gated entries into public evidence", async () => {
  const record = { id: "id", slug: "new", source: {}, kind: "image" } as MediaRecord;
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
