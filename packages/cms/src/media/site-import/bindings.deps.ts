import { adaptLegacyAuthorize, refuseUnexpectedKeys } from "@jini-ai/core";
import type { MediaRecord } from "@jini-ai/core/contracts/site/cms-media";
import type { MediaImportRefusalPorts } from "@jini-ai/core/contracts/site/media-tool-ports";
import type { VideoImportOptions } from "../site/import-video-conversion.js";
import type { MediaPublicUrlDeps } from "../site/contracts.js";
import type { bindMediaImportTools, MediaImportToolDeps } from "./bindings.js";
import type { MediaImportToolDeps as Ports } from "./tool-registrations.js";

export function bindMediaImportDeps<TVideo extends Pick<VideoImportOptions, "ports">>(
  { deps: routeDeps, resolvePublicUrls, videoImport, required, resolveLocalImportRequest, refusals }: {
    deps: MediaImportToolDeps;
    resolvePublicUrls: (input: { deps: MediaPublicUrlDeps & { workspaceId: string }; assets: readonly MediaRecord[] }) => Promise<Map<string, string | null>>;
    videoImport?: TVideo | undefined;
    required: Parameters<typeof bindMediaImportTools<TVideo>>[0];
    resolveLocalImportRequest: (input: Parameters<Parameters<typeof bindMediaImportTools<TVideo>>[0]["resolveSiteFileRequest"]>[0], optional?: Record<string, never>) => { rootPath: string; relativePath: string };
    refusals: MediaImportRefusalPorts;
  }, _optional: Record<string, never> = {},
): Ports {
  return {
    get workspaceId() { return routeDeps.workspaceId; }, get authorize() { return adaptLegacyAuthorize({ authorize: routeDeps.authorize }); }, get tracker() { return routeDeps.tracker; }, get imageCodec() { return routeDeps.imageCodec; },
    refuseUnexpectedKeys: (input, allowed) => refuseUnexpectedKeys({ input, allowed }),
    refusals: { ...refusals, logEgressRefusal: ({ line }) => (routeDeps.mediaImportEgressRefusalLog ?? required.logEgressRefusal)(line) },
    storage: { upload: ({ input }) => required.createConvertingUploader({ uploadDeps: { clock: routeDeps.clock, idGen: routeDeps.idGen, mediaRepo: routeDeps.mediaRepo, blobRepo: routeDeps.assetBlobRepo, renditionRepo: routeDeps.assetRenditionRepo, blobStore: routeDeps.blobStore }, caps: required.uploadCaps, mediaRepo: routeDeps.mediaRepo, clock: routeDeps.clock }, { video: videoImport })(input), recordContentType: input => routeDeps.mediaContentTypeStore.set({ ...input, workspaceId: routeDeps.workspaceId }), resolvePublicUrls: input => resolvePublicUrls({ deps: routeDeps, ...input }) },
    source: { fetchRemote: ({ url }) => required.fetchImage({ deps: { httpClient: routeDeps.mediaImportHttpClient, plainHttpTestOrigins: routeDeps.outboundTestOrigins }, url }), resolveLocal: input => resolveLocalImportRequest({ routeDeps, ...input }), readLocal: input => required.openFsFileForRead(input),
      localReadLimit: ({ relativePath }) => { const ceiling = required.uploadLimitForFile({ name: relativePath, type: "" }); return Math.min(routeDeps.mediaImportLocalMaxBytes ?? ceiling, ceiling); }, validateBytes: required.validateImageBytes },
    replacement: { findById: input => routeDeps.mediaRepo.findById({ workspaceId: routeDeps.workspaceId, ...input }), isAvailable: () => !!routeDeps.mediaRepo.replaceFileIfVersion && !!routeDeps.mediaRepo.saveRenditionIfSource,
      replace: ({ media, bytes, contentType, provenance, principalId }, { signal }) => required.replaceMediaFile({ deps: routeDeps, media, bytes, contentType, provenance, principalId }, { ...required.uploadCaps, videoCodecProbe: videoImport?.ports.videoCodecProbe, signal }) },
  };
}
