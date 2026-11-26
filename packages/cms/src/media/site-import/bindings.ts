import type { ToolContributor } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { ImageCodecPort, MediaRecord } from "@jini-ai/core/contracts/site/cms-media";
import type { MediaImportRefusalPorts, MediaImportSourcePorts, MediaStagedUploadInput, MediaToolUploadInput } from "@jini-ai/core/contracts/site/media-tool-ports";
import type { UploadMediaDeps } from "../media-service.js";
import type { VideoImportOptions } from "../site/import-video-conversion.js";
import type { replaceMediaFile } from "../replace-media-file.js";
import type { MediaPublicUrlDeps } from "../site/contracts.js";
import type { MediaContentTypeStorePort } from "../site/content-type-store.js";
import { MediaImportValidationError } from "../import/index.js";
import { buildMediaImportAgentToolCatalog } from "./agent-tools.js";
import { buildMediaImportRegistrations, mediaImportDerivedRisk, isImportShapeRejection, persistImportedMedia, withCallerSafeEgressRefusal } from "./tool-registrations.js";
import { bindMediaImportDeps } from "./bindings.deps.js";

/** The host's guarded media-import client. cms never sends through it: it only forwards the handle to
 * the host-injected `fetchImage`, so the host keeps its own `send` calling convention. */
export interface MediaImportHttpClient { send: (...args: never[]) => Promise<unknown> }

export interface MediaImportToolDeps extends Omit<UploadMediaDeps, "blobRepo" | "renditionRepo" | "mediaRepo">, MediaPublicUrlDeps {
  workspaceId: string; authorize: AuthorizeFn; tracker?: Tracker; imageCodec?: ImageCodecPort;
  siteBinding: { readonly dir: string }; resolveRoots?: () => Record<string, string | undefined>;
  mediaRepo: Parameters<typeof replaceMediaFile>[0]["deps"]["mediaRepo"];
  assetBlobRepo: UploadMediaDeps["blobRepo"]; assetRenditionRepo: UploadMediaDeps["renditionRepo"];
  mediaContentTypeStore: MediaContentTypeStorePort; mediaImportHttpClient: MediaImportHttpClient;
  outboundTestOrigins?: readonly string[]; mediaImportEgressRefusalLog?: (line: string) => void; mediaImportLocalMaxBytes?: number;
}

export function bindMediaImportTools<TVideo extends Pick<VideoImportOptions, "ports">>(required: {
  fsRootIds: readonly string[]; recoveryText: string; mediaAssetReadToolId: string;
  resolveSiteFileRequest(required: { routeDeps: Pick<MediaImportToolDeps, "siteBinding" | "workspaceId" | "resolveRoots">; root: string; relativePath: string }, optional: Record<string, never>): { rootPath: string; relativePath: string };
  openFsFileForRead: MediaImportSourcePorts["readLocal"];
  withLocalStream: MediaImportSourcePorts["withLocalStream"];
  withStagedFile: MediaImportSourcePorts["withStagedFile"];
  uploadLimitForFile(required: { name: string; type: string }): number;
  uploadCaps: { maxUploadBytes: number; maxVideoUploadBytes?: number };
  fetchImage(required: { deps: { httpClient: MediaImportHttpClient; plainHttpTestOrigins?: readonly string[] | undefined }; url: string }): ReturnType<MediaImportSourcePorts["fetchRemote"]>;
  validateImageBytes: MediaImportSourcePorts["validateBytes"];
  createConvertingUploader(input: { uploadDeps: UploadMediaDeps; caps: { maxUploadBytes: number; maxVideoUploadBytes?: number }; mediaRepo: MediaImportToolDeps["mediaRepo"]; clock: MediaImportToolDeps["clock"] }, optional: { video?: TVideo | undefined }): (input: MediaToolUploadInput) => Promise<{ media: MediaRecord }>; replaceMediaFile: typeof replaceMediaFile;
  createConvertingStagedUploader(input: { uploadDeps: UploadMediaDeps; caps: { maxUploadBytes: number; maxVideoUploadBytes?: number }; mediaRepo: MediaImportToolDeps["mediaRepo"]; clock: MediaImportToolDeps["clock"] }, optional: { video?: TVideo | undefined }): (input: MediaStagedUploadInput, optional?: { signal?: AbortSignal }) => Promise<{ media: MediaRecord }>;
  EgressRefusedError: new (required: { message: string }, optional: { callerSafeMessage: string }) => Error & { readonly callerSafeMessage: string };
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
  const refusals: MediaImportRefusalPorts = {
    isEgressRefusal: ({ error }) => error instanceof required.EgressRefusedError,
    describeEgressRefusal: ({ error }) => error instanceof required.EgressRefusedError
      ? { logMessage: error.message, callerSafeError: new required.EgressRefusedError({ message: error.callerSafeMessage }, { callerSafeMessage: error.callerSafeMessage }) } : undefined,
    isPathRefusal: required.isPathRefusal, logEgressRefusal: ({ line }) => required.logEgressRefusal(line),
  };
  return { mediaImportAgentToolCatalog: catalog, resolveLocalImportRequest,
    isImportShapeRejection: (input: { error: unknown }, _optional: Record<string, never> = {}) => isImportShapeRejection({ ...input, refusals }),
    withCallerSafeEgressRefusal: <T>({ work, log }: { work: () => Promise<T>; log: (line: string) => void }, optional: { toolId?: string } = {}) => withCallerSafeEgressRefusal({ work, refusals: { ...refusals, logEgressRefusal: ({ line }) => log(line) } }, optional),
    persistImportedMedia: ({ routeDeps, resolvePublicUrls, ...input }: { routeDeps: MediaImportToolDeps; resolvePublicUrls: Parameters<typeof bindMediaImportDeps<TVideo>>[0]["resolvePublicUrls"]; input: MediaToolUploadInput; sourceUrl: string; actorId: string }, optional: { videoImport?: TVideo | undefined } = {}) => persistImportedMedia({ ...input, tracker: routeDeps.tracker, storage: bindMediaImportDeps({ deps: routeDeps, resolvePublicUrls, ...optional, required, resolveLocalImportRequest, refusals }, {}).storage }),
    buildMediaImportRegistrations: (input: Pick<Parameters<typeof bindMediaImportDeps<TVideo>>[0], "deps" | "resolvePublicUrls" | "videoImport">, _optional: Record<string, never> = {}) => buildMediaImportRegistrations({ deps: bindMediaImportDeps({ ...input, required, resolveLocalImportRequest, refusals }, {}), catalog }),
    contributeMediaImportTools: (input: Pick<Parameters<typeof bindMediaImportDeps<TVideo>>[0], "resolvePublicUrls" | "videoImport">, _optional: Record<string, never> = {}): ToolContributor<MediaImportToolDeps, unknown> => ({ domain: "media-import", build: deps => buildMediaImportRegistrations({ deps: bindMediaImportDeps({ deps, ...input, required, resolveLocalImportRequest, refusals }, {}), catalog }), risk: mediaImportDerivedRisk }),
  };
}
