import type { QueryKey } from "@jini-ai/core/fetch";
import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";

/**
 * @file Pure rules for the Library screen: which files the Upload tab accepts, how a document row
 * is labelled, and which preview a document gets. The server re-checks every one of these
 * (`@jini-ai/cms/media`'s `validateDocumentIngress` sniffs the bytes); the client copy only spares
 * the operator a round trip that is certain to fail.
 */

/** One cache identity for the Documents list; every Library write invalidates it. */
export const LIBRARY_KEYS = {
  documents: ["library", "documents"] as QueryKey,
  permissions: ["library", "permissions"] as QueryKey,
  users: ["library", "users"] as QueryKey,
};

/** Mirrors `@jini-ai/cms/media`'s `DOCUMENT_CONTENT_TYPES` keys; the server stays the authority. */
export const LIBRARY_EXTENSIONS = ["md", "txt", "pdf", "docx", "csv", "json", "doc", "xls", "rtf", "xlsx", "pptx", "pages", "key"] as const;
export type LibraryExtension = (typeof LIBRARY_EXTENSIONS)[number];

/** Mirrors `@jini-ai/cms/media`'s `MAX_DOCUMENT_BYTES` (10 MiB). */
export const LIBRARY_MAX_BYTES = 10 * 1024 * 1024;

/** The native picker's `accept` list. */
export const LIBRARY_ACCEPT = LIBRARY_EXTENSIONS.map((ext) => `.${ext}`).join(",");

/** Lower-case extension after the last dot, or `""` when the name has none. */
export function libraryExtension({ filename }: { filename: string }, _optional = {}): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

export type LibraryFileProblem = "type" | "size" | "empty" | "package";

/** Why a picked file cannot be uploaded, or `null` when it may be sent. */
export function libraryFileProblem(file: { name: string; size: number }): LibraryFileProblem | null {
  if (!(LIBRARY_EXTENSIONS as readonly string[]).includes(libraryExtension({ filename: file.name }))) return "type";
  if (file.size === 0) return ["pages", "key"].includes(libraryExtension({ filename: file.name })) ? "package" : "empty";
  if (file.size > LIBRARY_MAX_BYTES) return "size";
  return null;
}

/** `1.2 MB`-style size. Binary units, matching the server's MiB cap. */
export function formatLibraryBytes({ bytes }: { bytes: number | null | undefined }, _optional = {}): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The name the operator sees: the server's `displayFilename`, else title + original extension. */
export function documentName(item: Pick<AdminMedia, "title" | "displayFilename" | "originalFilename">): string {
  if (item.displayFilename) return item.displayFilename;
  const ext = libraryExtension({ filename: item.originalFilename ?? "" });
  return ext ? `${item.title}.${ext}` : item.title;
}

/** Upper-case type badge (`MD`, `PDF`, …) from the immutable original filename. */
export function documentTypeLabel(item: Pick<AdminMedia, "originalFilename" | "displayFilename">): string {
  return libraryExtension({ filename: item.originalFilename ?? item.displayFilename ?? "" }).toUpperCase() || "—";
}

/** The fixed extension suffix rename keeps (`.md`), or `""`. */
export function documentExtensionSuffix(item: Pick<AdminMedia, "originalFilename" | "displayFilename">): string {
  const ext = libraryExtension({ filename: item.originalFilename ?? item.displayFilename ?? "" });
  return ext ? `.${ext}` : "";
}

export type LibraryPreviewKind = "markdown" | "text" | "pdf" | "download";

/** Markdown renders (raw HTML off); text/CSV/JSON show escaped; PDF uses the browser's PDF viewer;
 *  Office, iWork and RTF documents download only (no extraction in v1). */
export function documentPreviewKind(item: Pick<AdminMedia, "originalFilename" | "displayFilename">): LibraryPreviewKind {
  switch (libraryExtension({ filename: item.originalFilename ?? item.displayFilename ?? "" })) {
    case "md":
      return "markdown";
    case "txt":
    case "csv":
    case "json":
      return "text";
    case "pdf":
      return "pdf";
    default:
      return "download";
  }
}

/** Mirrors the server's rename rule: a non-empty stem of at most 240 characters, no slashes or
 *  control characters. Returns the trimmed stem, or `null` when the server would refuse it. */
export function validDocumentStem({ draft }: { draft: string }, _optional = {}): string | null {
  const stem = draft.trim();
  if (!stem || stem.length > 240 || /[\\/\u0000-\u001f\u007f]/u.test(stem)) return null;
  return stem;
}

/** Principal id -> username; "Unknown" when the row has no uploader. */
export function documentUploaderLabel(required: {
  item: Pick<AdminMedia, "createdBy">; unknownLabel: string;
}, optional: { userNames?: ReadonlyMap<string, string> } = {}): string {
  const id = required.item.createdBy;
  if (!id) return required.unknownLabel;
  return optional.userNames?.get(id) ?? id;
}

/** Newest first. */
export function sortDocuments({ items }: { items: readonly AdminMedia[] }, _optional: Record<string, never> = {}): AdminMedia[] {
  return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
