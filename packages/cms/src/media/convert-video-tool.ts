/**
 * @file The `media_convert_video` agent tool: converts one stored video into a web-safe MP4 copy.
 *
 * Registered only when a host injects a {@link MediaTranscoderPort} (see
 * `tool-registrations.ts`'s `videoConversion` option), so a host with no transcoder never shows the
 * assistant a tool it cannot run. The conversion is costly (minutes of CPU) and adds a library
 * item, so the entry declares approval metadata: the owner confirms each call directly.
 */
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { Clock, IdGenerator } from "@jini-ai/core/primitives";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString, type AgentToolDefinition, type AgentToolSideEffect, type ToolRegistration } from "@jini-ai/core";
import { adaptLegacyAuthorize, requireToolPermission } from "../core/tools/index.js";
import type { AssetBlobRepoPort, AssetRenditionRepoPort, BlobStorePort, MediaRepoPort } from "./ports.js";
import { VideoConversionError, convertMediaVideo, type DerivedMediaLinkPort, type MediaTranscoderPort } from "./video-transcode.js";

export const CONVERT_VIDEO_TOOL_ID = "media_convert_video";

export const convertVideoToolDefinition: AgentToolDefinition = {
  name: CONVERT_VIDEO_TOOL_ID,
  description:
    "Makes a copy of a video that plays in every web browser (MP4, H.264 video, AAC sound, at most 1920 pixels wide). " +
    "The original video is kept unchanged; the copy is saved as a new library item titled \"<original title> (web)\". " +
    "Use it when a video (often an iPhone .mov) does not play on the site. Only videos can be converted. " +
    "Converting can take several minutes, and the owner must approve each conversion.",
  sideEffects: "mutates-durable-state",
  authorization: { permission: "media.upload" },
  metadata: {
    title: "Convert video for web",
    actionVerb: "Convert",
    summary: "Creates a web-playable MP4 copy of this video. The original stays as it is.",
    approval: { class: "edit", confirmation: "direct" },
  },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["mediaId"],
    properties: { mediaId: { type: "string", minLength: 1, description: "Id of the video to convert (from media_list_assets)." } },
  },
};

const CATALOG = indexCatalogById({ catalog: [convertVideoToolDefinition] });
// -> convertMediaVideo: blob/media/rendition writes plus a provenance link; never a delete.
const DERIVED_RISK: ReadonlyMap<string, AgentToolSideEffect> = new Map([[CONVERT_VIDEO_TOOL_ID, "mutates-durable-state"]]);

/** Host-provided conversion capability; its presence is what turns the tool on. */
export interface VideoConversionToolOptions {
  transcoder: MediaTranscoderPort;
  linkDerivedMedia: DerivedMediaLinkPort;
  randomHex?: ((required: { bytes: number }) => string) | undefined;
  maxInputBytes?: number | undefined;
  maxOutputBytes?: number | undefined;
}
export interface ConvertVideoToolDeps extends VideoConversionToolOptions {
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: Clock;
  idGen: IdGenerator;
  mediaRepo: MediaRepoPort;
  assetBlobRepo: AssetBlobRepoPort;
  assetRenditionRepo: AssetRenditionRepoPort;
  blobStore: BlobStorePort;
}

/**
 * Builds the `media_convert_video` registration. Expected refusals (not a video, too large, no
 * ffmpeg, ...) come back as `{ converted: false, error }` in plain words with an `ERR-` id so the
 * assistant can relay them; a cancellation and unexpected errors are thrown.
 * @complexity O(1) to build; each call is O(video bytes).
 */
export function buildConvertVideoRegistrations(deps: ConvertVideoToolDeps, _optional: Record<string, never> = {}): ToolRegistration[] {
  const conversionDeps = {
    clock: deps.clock, idGen: deps.idGen, mediaRepo: deps.mediaRepo, blobRepo: deps.assetBlobRepo,
    renditionRepo: deps.assetRenditionRepo, blobStore: deps.blobStore, transcoder: deps.transcoder,
    linkDerivedMedia: deps.linkDerivedMedia, randomHex: deps.randomHex,
  };
  return buildDomainRegistrations({
    domain: "media",
    catalogModule: "media/convert-video-tool.ts",
    catalog: CATALOG,
    derivedRisk: DERIVED_RISK,
    handlers: {
      [CONVERT_VIDEO_TOOL_ID]: async (ctx) => {
        const mediaId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "mediaId" });
        await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "media.upload" }, { entityType: "media", entityId: mediaId });
        try {
          const { originalId, convertedId, media } = await convertMediaVideo(
            { deps: conversionDeps, input: { workspaceId: deps.workspaceId, mediaId, createdByPrincipal: ctx.principal.id } },
            { signal: ctx.signal, maxInputBytes: deps.maxInputBytes, maxOutputBytes: deps.maxOutputBytes });
          return { converted: true, originalId, convertedId, media: { id: media.id, title: media.title, slug: media.slug, status: media.status } };
        } catch (error) {
          if (!(error instanceof VideoConversionError) || error.reason === "canceled") throw error;
          return { converted: false, error: { reason: error.reason, errorId: error.errorId, message: error.message } };
        }
      },
    },
  });
}
