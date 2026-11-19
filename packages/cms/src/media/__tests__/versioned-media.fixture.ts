import type { MediaRecord } from "../types.js";

export const WORKSPACE_ID = "workspace-1";

export function makeMedia(overrides: Partial<MediaRecord> = {}): MediaRecord {
  return {
    kind: "media",
    originalFilename: null,
    id: "media-1",
    workspaceId: WORKSPACE_ID,
    title: "A photo",
    slug: "a-photo",
    alt: "alt text",
    caption: "a caption",
    credit: "a credit",
    source: { sha256: "a".repeat(64) },
    status: "active",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    version: 1,
    width: null,
    height: null,
    cssClass: null,
    htmlAttributes: null,
    ...overrides,
  };
}

