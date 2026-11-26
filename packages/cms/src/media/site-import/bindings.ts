import { adaptLegacyAuthorize, refuseUnexpectedKeys, type ToolContributor } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { ImageCodecPort, MediaRecord } from "@jini-ai/core/contracts/site/cms-media";
import type { MediaImportRefusalPorts, MediaImportSourcePorts, MediaToolUploadInput } from "@jini-ai/core/contracts/site/media-tool-ports";
import type { UploadMediaDeps } from "../media-service.js";
import type { createConvertingUploader, VideoImportOptions } from "../site/import-video-conversion.js";
import type { replaceMediaFile } from "../replace-media-file.js";
import type { MediaPublicUrlDeps } from "../site/contracts.js";
import type { MediaContentTypeStorePort } from "../site/content-type-store.js";
import { MediaImportValidationError } from "../import/index.js";
import { buildMediaImportAgentToolCatalog } from "./agent-tools.js";
import { buildMediaImportRegistrations, mediaImportDerivedRisk, isImportShapeRejection, persistImportedMedia, withCallerSafeEgressRefusal, type MediaImportToolDeps as Ports } from "./tool-registrations.js";

export interface MediaImportToolDeps extends Omit<UploadMediaDeps, "blobRepo" | "renditionRepo" | "mediaRepo">, MediaPublicUrlDeps {
  workspaceId: string; authorize: AuthorizeFn; tracker?: Tracker; imageCodec?: ImageCodecPort;
  siteBinding: { readonly dir: string }; resolveRoots?: () => Record<string, string | undefined>;
  mediaRepo: Parameters<typeof replaceMediaFile>[0]["deps"]["mediaRepo"];
  assetBlobRepo: UploadMediaDeps["blobRepo"]; assetRenditionRepo: UploadMediaDeps["renditionRepo"];
  mediaContentTypeStore: MediaContentTypeStorePort; mediaImportHttpClient: HttpClientPort;
  outboundTestOrigins?: readonly string[]; mediaImportEgressRefusalLog?: (line: string) => void; mediaImportLocalMaxBytes?: number;
}

export function bindMediaImportTools(required: {
  fsRootIds: readonly string[]; recoveryText: string; mediaAssetReadToolId: string;
  resolveSiteFileRequest(required: { routeDeps: Pick<MediaImportToolDeps, "siteBinding" | "workspaceId" | "resolveRoots">; root: string; relativePath: string }, optional: Record<string, never>): { rootPath: string; relativePath: string };
  openFsFileForRead: MediaImportSourcePorts["readLocal"];
  uploadLimitForFile(required: { name: string; type: string }): number;
  uploadCaps: Parameters<typeof createConvertingUploader>[0]["caps"];
  fetchImage(required: { deps: { httpClient: HttpClientPort; plainHttpTestOrigins?: readonly string[] }; url: string }): ReturnType<MediaImportSourcePorts["fetchRemote"]>;
  validateImageBytes: MediaImportSourcePorts["validateBytes"];
  createConvertingUploader(input: Parameters<typeof createConvertingUploader>[0] & { mediaRepo: MediaImportToolDeps["mediaRepo"]; clock: MediaImportToolDeps["clock"] }, optional: Parameters<typeof createConvertingUploader>[1]): ReturnType<typeof createConvertingUploader>; replaceMediaFile: typeof replaceMediaFile;
  isEgressRefusal: MediaImportRefusalPorts["isEgressRefusal"]; describeEgressRefusal: MediaImportRefusalPorts["describeEgressRefusal"];
  isPathRefusal: MediaImportRefusalPorts["isPathRefusal"]; logEgressRefusal: (line: string) => void;
}, _optional: Record<string, never> = {}) {
  const catalog = buildMediaImportAgentToolCatalog({ fsRootIds: required.fsRootIds, fsFolderReadRecovery: required.recoveryText, mediaAssetReadToolId: required.mediaAssetReadToolId });
  /** Resolve a site or owner-picked source through the same execution boundary as fs-files.
   * Returns the validated I/O root, so a custom symlink cannot become a new trusted base.
   * @throws MediaImportValidationError for unavailable roots; FsFilePathError for unsafe source paths.
   * Both include the shared picker recovery without granting access to an unpicked folder.
   * @complexity O(path depth), bounded guarded-reader filesystem checks.
   */
  const resolveLocalImportRequest = (input: { routeDeps: Pick<MediaImportToolDeps, "siteBinding" | "workspaceId" | "resolveRoots">; root: string; relativePath: string }, _optional: Record<string, never> = {}) => {
    try { return required.resolveSiteFileRequest(input, {}); }
    catch (error) {
      if (required.isPathRefusal({ error })) throw error;
      const message = error instanceof Error ? error.message : `Source must be inside this site or the owner-picked folder. ${required.recoveryText}`;
      throw new MediaImportValidationError({ message });
    }
  };
  const refusals: MediaImportRefusalPorts = { isEgressRefusal: required.isEgressRefusal, describeEgressRefusal: required.describeEgressRefusal, isPathRefusal: required.isPathRefusal, logEgressRefusal: ({ line }) => required.logEgressRefusal(line) };
  const bindDeps = ({ deps: routeDeps, resolvePublicUrls, videoImport }: { deps: MediaImportToolDeps; resolvePublicUrls: (input: { deps: MediaPublicUrlDeps & { workspaceId: string }; assets: readonly MediaRecord[] }) => Promise<Map<string, string | null>>; videoImport?: VideoImportOptions | undefined }): Ports => ({
    get workspaceId() { return routeDeps.workspaceId; }, get authorize() { return adaptLegacyAuthorize({ authorize: routeDeps.authorize }); }, get tracker() { return routeDeps.tracker; }, get imageCodec() { return routeDeps.imageCodec; },
    refuseUnexpectedKeys: (input, allowed) => refuseUnexpectedKeys({ input, allowed }),
    refusals: { ...refusals, logEgressRefusal: ({ line }) => (routeDeps.mediaImportEgressRefusalLog ?? required.logEgressRefusal)(line) },
    storage: { upload: ({ input }) => required.createConvertingUploader({ uploadDeps: { clock: routeDeps.clock, idGen: routeDeps.idGen, mediaRepo: routeDeps.mediaRepo, blobRepo: routeDeps.assetBlobRepo, renditionRepo: routeDeps.assetRenditionRepo, blobStore: routeDeps.blobStore }, caps: required.uploadCaps, mediaRepo: routeDeps.mediaRepo, clock: routeDeps.clock }, { video: videoImport })(input), recordContentType: input => routeDeps.mediaContentTypeStore.set({ ...input, workspaceId: routeDeps.workspaceId }), resolvePublicUrls: input => resolvePublicUrls({ deps: routeDeps, ...input }) },
    source: { fetchRemote: ({ url }) => required.fetchImage({ deps: { httpClient: routeDeps.mediaImportHttpClient, plainHttpTestOrigins: routeDeps.outboundTestOrigins }, url }), resolveLocal: input => resolveLocalImportRequest({ routeDeps, ...input }), readLocal: input => required.openFsFileForRead(input),
      localReadLimit: ({ relativePath }) => { const ceiling = required.uploadLimitForFile({ name: relativePath, type: "" }); return Math.min(routeDeps.mediaImportLocalMaxBytes ?? ceiling, ceiling); }, validateBytes: required.validateImageBytes },
    replacement: { findById: input => routeDeps.mediaRepo.findById({ workspaceId: routeDeps.workspaceId, ...input }), isAvailable: () => !!routeDeps.mediaRepo.replaceFileIfVersion && !!routeDeps.mediaRepo.saveRenditionIfSource,
      replace: ({ media, bytes, contentType, provenance, principalId }, { signal }) => required.replaceMediaFile({ deps: routeDeps, media, bytes, contentType, provenance, principalId }, { ...required.uploadCaps, videoCodecProbe: videoImport?.ports.videoCodecProbe, signal }) },
  });
  return { mediaImportAgentToolCatalog: catalog, resolveLocalImportRequest,
    isImportShapeRejection: (input: { error: unknown }, _optional: Record<string, never> = {}) => isImportShapeRejection({ ...input, refusals }),
    withCallerSafeEgressRefusal: <T>({ work, log }: { work: () => Promise<T>; log: (line: string) => void }, optional: { toolId?: string } = {}) => withCallerSafeEgressRefusal({ work, refusals: { ...refusals, logEgressRefusal: ({ line }) => log(line) } }, optional),
    persistImportedMedia: ({ routeDeps, resolvePublicUrls, ...input }: { routeDeps: MediaImportToolDeps; resolvePublicUrls: Parameters<typeof bindDeps>[0]["resolvePublicUrls"]; input: MediaToolUploadInput; sourceUrl: string; actorId: string }, optional: { videoImport?: VideoImportOptions | undefined } = {}) => persistImportedMedia({ ...input, tracker: routeDeps.tracker, storage: bindDeps({ deps: routeDeps, resolvePublicUrls, ...optional }).storage }),
    buildMediaImportRegistrations: (routeDeps: MediaImportToolDeps, optional: Omit<Parameters<typeof bindDeps>[0], "deps">) => buildMediaImportRegistrations({ deps: bindDeps({ deps: routeDeps, ...optional }), catalog }),
    contributeMediaImportTools: (optional: Omit<Parameters<typeof bindDeps>[0], "deps">): ToolContributor<MediaImportToolDeps, unknown> => ({ domain: "media-import", build: routeDeps => buildMediaImportRegistrations({ deps: bindDeps({ deps: routeDeps, ...optional }), catalog }), risk: mediaImportDerivedRisk }),
  };
}
