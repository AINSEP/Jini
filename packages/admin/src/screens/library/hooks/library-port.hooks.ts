import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";

/**
 * @file Everything the Library screen reads or writes, as one injectable port — the same
 * `MediaPort` convention (`features/media/hooks/media-port.hooks.ts`), so tests pass
 * `createFakeLibraryPort` instead of stubbing `fetch`.
 */
export interface LibraryPort {
  listDocuments(): Promise<{ media: AdminMedia[] }>;
  uploadDocument(input: { filename: string; dataBase64: string }, optional?: Record<string, never>): Promise<{ media: AdminMedia }>;
  /** Rename changes the display stem only; the extension and stored bytes never change. */
  renameDocument(required: { target: { id: string }; input: { title: string } }, optional?: Record<string, never>): Promise<{ media: AdminMedia }>;
  trashDocument(required: { id: string }, optional?: Record<string, never>): Promise<{ media: AdminMedia }>;
  readDocumentText(target: { id: string }, optional?: Record<string, never>): Promise<{ text: string; truncated: boolean }>;
  /** The authenticated download URL (served as an attachment). */
  documentDownloadUrl(required: { id: string }, optional?: Record<string, never>): string;
  /** The original bytes, for the browser's PDF viewer. */
  fetchDocumentBlob(required: { id: string }, optional?: Record<string, never>): Promise<Blob>;
  me(): Promise<{ effectivePermissions?: string[] }>;
  /** Names uploaders. Optional: without it (or when it fails) rows show the raw principal id. */
  listUsers?(): Promise<{ users: ReadonlyArray<{ principalId: string; username: string }> }>;
}
