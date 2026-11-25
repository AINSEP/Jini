import type { AdminMedia } from "@jini-ai/core/contracts/site/cms-admin-media";
import type { LibraryPort } from "./library-port.hooks.js";

/** @file Maps the Library port onto an admin API client — the host injects the client and `fetch`. */

/** The slice of `lib/api.ts` the production Library port calls, typed to just the fields the port
 *  reads, so `api` satisfies it and a test passes a small hand-written fake. */
export interface LibraryApiClient {
  listDocuments(): Promise<{ media: AdminMedia[] }>;
  uploadDocument(input: { filename: string; dataBase64: string }): Promise<{ media: AdminMedia }>;
  updateMedia(target: { id: string }, patch: { title: string }): Promise<{ media: AdminMedia }>;
  trashMedia(required: { id: string }, optional?: Record<string, never>): Promise<{ media: AdminMedia }>;
  readDocumentText(target: { id: string }): Promise<{ text: string; truncated: boolean }>;
  mediaOriginalUrl(required: { id: string }, optional?: Record<string, never>): string;
  me(): Promise<{ effectivePermissions?: string[] }>;
  listUsers(): Promise<{ users: ReadonlyArray<{ principalId: string; username: string }> }>;
}

/** Only the call shape `fetchDocumentBlob` makes, so a test passes a plain function. */
export type LibraryFetch = (required: { url: string; init: RequestInit }, optional?: Record<string, never>) => Promise<Pick<Response, "ok" | "status" | "blob">>;

/**
 * Maps the Library port onto the admin API client. `client` and `fetchFn` are injected so the
 * mapping (which endpoint each port method hits, and the failed-download error) is testable with
 * plain fakes; `defaultLibraryPort` below wires the real ones.
 */
export function createApiLibraryPort({ client, fetchFn }: { client: LibraryApiClient; fetchFn: LibraryFetch }): LibraryPort {
  return {
    listDocuments: () => client.listDocuments(),
    uploadDocument: (input, _optional = {}) => client.uploadDocument(input),
    renameDocument: ({ target, input }, _optional = {}) => client.updateMedia(target, { title: input.title }),
    trashDocument: ({ id }, _optional = {}) => client.trashMedia({ id }),
    readDocumentText: (target, _optional = {}) => client.readDocumentText(target),
    documentDownloadUrl: ({ id }, _optional = {}) => client.mediaOriginalUrl({ id }),
    fetchDocumentBlob: async ({ id }, _optional = {}) => {
      const res = await fetchFn({ url: client.mediaOriginalUrl({ id }), init: { credentials: "same-origin" } });
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      return res.blob();
    },
    me: () => client.me(),
    listUsers: () => client.listUsers(),
  };
}
