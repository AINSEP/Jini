import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";

export function libraryDocument({ id, title, extension, ...overrides }: { id: string; title: string; extension: string } & Partial<Omit<AdminMedia, "id" | "title">>): AdminMedia {
  return {
    id, title, kind: "document", workspaceId: "editorial", slug: id,
    originalFilename: `upload.${extension}`, displayFilename: `${title}.${extension}`, createdBy: "author-7",
    alt: "", caption: "", credit: "", sha256: "a".repeat(64), byteSize: 1536, status: "active",
    createdAt: "2026-11-20T09:30:00Z", updatedAt: "2026-11-21T15:30:00Z", version: 3,
    width: null, height: null, cssClass: null, htmlAttributes: null, contentType: null, publicUrl: null,
    ...overrides,
  };
}
