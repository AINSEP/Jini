/** Site adapter for anonymous form uploads. Media owns blobs, assets, deduplication and renditions. */
import { sniffContentType, uploadMedia, trashMedia, type UploadMediaDeps } from "../../media/index.js";
import { purgeMedia } from "../../media/site/purge-media.js";
import { type MediaContentTypeStorePort } from "../../media/site/content-type-store.js";
/** Structural until the updated Jini forms declarations are built; no new runtime package imports. */
export interface FormFileStorage {
  detectContentType(required: { bytes: Uint8Array }, optional?: Record<string, never>): string;
  store(required: { workspaceId: string; submissionId: string; fieldId: string; file: { filename: string; contentType: string; bytes: Uint8Array } }, optional?: Record<string, never>): Promise<{ mediaId: string; filename: string; contentType: string; byteSize: number }>;
  discard(required: { workspaceId: string; reference: { mediaId: string } }, optional?: Record<string, never>): Promise<void>;
}
/** Binds existing storage ports. PDF signature support stays local until Jini's media sniffer gains it.
 * @returns A byte sniffer and media writer; the forms owner checks filename/MIME/size before store.
 * @complexity Fixed-prefix sniff, O(bytes) media hashing/storage, at most 20 files per submission. */
export function createFormFileStorage(
  { media, contentTypes, resolveCreatedByPrincipal }: {
    media: UploadMediaDeps & Parameters<typeof purgeMedia>[0]["deps"];
    contentTypes: MediaContentTypeStorePort;
    /** Anonymous uploads are attributed to the host's real system principal, never visitor input. */
    resolveCreatedByPrincipal: (required: { workspaceId: string }, optional?: Record<string, never>) => Promise<string>;
  },
  _optional = {},
): FormFileStorage {
  return {
    detectContentType: ({ bytes }) => Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-" ? "application/pdf" : sniffContentType({ bytes }),
    async store({ workspaceId, submissionId, fieldId, file }) {
      // Server-generated names avoid collisions between visitors; original filename is only an
      // escaped display value in the submission, never a storage path or executable extension.
      const extension = file.filename.split(".").at(-1);
      if (extension === undefined) throw new Error("Form file has no filename extension");
      const filename = `${submissionId}-${fieldId}.${extension.toLowerCase()}`;
      const createdByPrincipal = await resolveCreatedByPrincipal({ workspaceId }, {});
      const { media: asset } = await uploadMedia({ deps: media, input: { workspaceId, access: "private", bytes: file.bytes, filename, contentType: file.contentType, createdByPrincipal } }, { maxUploadBytes: 10 * 1024 * 1024, allowedMimeTypes: new Set([file.contentType]) });
      try { await contentTypes.set({ workspaceId, sha256: asset.source.sha256, contentType: file.contentType }); }
      catch (error) {
        await trashMedia({ deps: { mediaRepo: media.mediaRepo, clock: media.clock }, input: { workspaceId, id: asset.id } });
        await purgeMedia({ deps: media, input: { workspaceId, id: asset.id } });
        throw error;
      }
      return { mediaId: asset.id, filename: file.filename, contentType: file.contentType, byteSize: file.bytes.byteLength };
    },
    async discard({ workspaceId, reference }) {
      // Remove only the asset minted for a failed attempt; shared blob bytes keep media's GC grace.
      await trashMedia({ deps: { mediaRepo: media.mediaRepo, clock: media.clock }, input: { workspaceId, id: reference.mediaId } });
      await purgeMedia({ deps: media, input: { workspaceId, id: reference.mediaId } });
    },
  };
}
