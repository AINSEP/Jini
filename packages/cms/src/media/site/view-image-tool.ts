import { toolMetadata } from '@jini-ai/core/tool-metadata/media';
import { adaptLegacyAuthorize } from "../../core/tools/index.js";
import { ToolInputError } from "@jini-ai/core";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, requireString, type AgentToolDefinition as SharedAgentToolDefinition, type AgentToolSideEffect, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { requireToolPermission } from "../../core/tools/index.js";
import type { ImageCodecPort } from "../index.js";

import type { ToolContributor } from "@jini-ai/core";
import { readStoredBytes } from "./original-bytes.js";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { sniffContentType, type AssetBlobRepoPort, type BlobStorePort, type MediaRecord, type MediaRepoPort } from "../index.js";

/**
 * @file `media_view_image` — lets the assistant LOOK at one media-library image.
 *
 * Found by a real run: asked to write alt text, the assistant answered that none of its tools could
 * open an image and refused to guess. Every other media tool returns metadata and a `publicUrl`, and
 * a URL is not something the model can see. This tool returns the picture itself as an MCP `image`
 * content block (`{type:'image', mimeType, data}`) beside a `text` block of the asset's metadata —
 * the same typed-media shape the host demo image tool proves end to end, which every delivery
 * path keeps intact: the daemon's delegated-tool bridge treats `image` as model-visible
 * (`@jini-ai/daemon`'s `tool-result-surfaces.ts`), `@jini-ai/mcp`'s gateway unwraps and forwards it
 * verbatim, and the BYOK surface maps it onto each provider's own image part
 * (the host BYOK provider turn).
 *
 * Named `media_*`, not with the host content-read tool's card prefix: that prefix means "one of the
 * host content-read tool's 29 derived cards" — the host's content-read tool test and the parent-tool-read
 * eval both identify cards by it — and this is an ordinary contributor with no older read tool to collapse.
 * The host passes that read tool's media-asset card id in as `mediaAssetReadToolId`, where the model is
 * told how to find an id or slug.
 *
 * ## Size
 *
 * Re-encoded as WebP, long edge at most {@link VIEW_IMAGE_MAX_EDGE_PX}, never enlarged. 1568px is
 * the long edge past which Claude's vision input is downscaled anyway, so anything larger only costs
 * bytes and tokens. WebP rather than JPEG because it keeps transparency (a logo on a transparent
 * background would otherwise come back on black), and every BYOK provider accepts it. EXIF
 * orientation is applied first, so the model sees the photo the right way up.
 *
 * ## What it refuses
 *
 * The decision is made from the stored BYTES (`sniffContentType`), never the declared type: a video
 * is refused with a pointer to `media_view_video` (video extraction is a separate injected port,
 * with optional host ffmpeg), and anything else that is not a decodable raster image is
 * refused by name. Every refusal is a `ToolInputError`, so the model gets the reason, not a redacted
 * internal error.
 */

export const MEDIA_VIEW_IMAGE_TOOL_ID = "media_view_image";

/** Long-edge cap for the returned image — see this file's header, "Size". */
export const VIEW_IMAGE_MAX_EDGE_PX = 1568;

const WEBP_QUALITY = 80;

/** Everything the tool reads. A narrow slice of `RouteDeps`, so a test can pass in-memory repos. */
export interface MediaViewImageToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  mediaRepo: MediaRepoPort;
  assetBlobRepo: AssetBlobRepoPort;
  blobStore: BlobStorePort;
  imageCodec: ImageCodecPort;
}

/** This wired tool requires the input schema that the shared catalog contract allows to be absent. */
type AgentToolDefinition = SharedAgentToolDefinition & { inputSchema: Readonly<Record<string, unknown>> };

/** Required args for {@link buildMediaViewImageAgentToolCatalog}. */
export interface MediaViewImageAgentToolCatalogArgs {
  /** The host's read tool id for one media asset, named where the model is told how to find an id or slug. */
  mediaAssetReadToolId: string;
  mediaMetadataWriteToolId: string;
}

/** Builds the tool's catalog with the host's media-asset read tool id bound into its description. */
export function buildMediaViewImageAgentToolCatalog(
  { mediaAssetReadToolId, mediaMetadataWriteToolId }: MediaViewImageAgentToolCatalogArgs,
  _optional: Record<string, never> = {},
): AgentToolDefinition[] {
  return [{
    name: MEDIA_VIEW_IMAGE_TOOL_ID,
    // Only the authorized write path may change durable metadata, even when a read supplies the evidence.
    description:
      "THIS IS HOW TO LOOK AT / SEE / VIEW AN IMAGE in the media library — opens one image and returns the actual picture so you can see what it shows. " +
      "Call this before writing or improving alt text, writing a caption, describing a photo, checking what a picture contains, or choosing between images; " +
      `never guess what an image shows from its title or filename. Pass exactly one of \`mediaId\` or \`slug\` (find them with ${mediaAssetReadToolId}). ` +
      `Returns the image (WebP, long edge at most ${VIEW_IMAGE_MAX_EDGE_PX}px, downscaled when larger) plus its metadata as JSON: id, slug, title, current alt, caption, status, the original's type and dimensions, and the returned dimensions. ` +
      `Read-only: it changes nothing — to save new alt text afterwards, use ${mediaMetadataWriteToolId}. ` +
      `When asked to save what you see, call ${mediaMetadataWriteToolId} with a short factual description of the picture and the asset's current version. ` +
      "For video still frames use media_view_video; this tool refuses anything that is not a still image.",
    sideEffects: "none",
    authorization: { permission: "media.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        mediaId: { type: "string", description: "The media asset's id. Pass this or `slug`, not both." },
        slug: { type: "string", description: "The media asset's slug (short lookup name). Pass this or `mediaId`, not both." },
      },
    },
  }];
}

export const mediaViewImageDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> mediaRepo.findById/findBySlug + assetBlobRepo.findByHash + blobStore.get + an in-memory
  // re-encode. Nothing is written anywhere.
  [MEDIA_VIEW_IMAGE_TOOL_ID, "none"],
]);

/** Prefixes every refusal with the tool id, so the model can tell which call it came from. */
function refusal({ message }: { message: string }, _optional: Record<string, never> = {}): ToolInputError {
  return new ToolInputError({ message: `${MEDIA_VIEW_IMAGE_TOOL_ID}: ${message}` });
}

/** @throws {ToolInputError} When no asset matches. */
async function findAsset({ deps, mediaId, mediaAssetReadToolId }: { deps: MediaViewImageToolDeps; mediaId: string; mediaAssetReadToolId: string }, _options = {}): Promise<MediaRecord> {
  // The shared assistant adapter resolves slugs; this domain reads only the authorized id.
  const found = await deps.mediaRepo.findById({ workspaceId: deps.workspaceId, id: mediaId });
  if (!found) {
    throw refusal({ message: `no media asset with id or slug '${mediaId}'. Use ${mediaAssetReadToolId} to list the library and find the right id or slug.` });
  }
  return found;
}

interface RenderedImage {
  data: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

/** EXIF orientations 5-8 rotate by 90°, so the stored width/height are swapped relative to what a viewer sees. */
function isQuarterTurn({ orientation }: { orientation: number | undefined }, _optional: Record<string, never> = {}): boolean {
  return orientation !== undefined && orientation >= 5;
}

/**
 * Applies EXIF orientation, bounds the long edge, and re-encodes as WebP.
 *
 * @throws {ToolInputError} When `sharp` cannot decode the bytes.
 * @complexity O(pixels) — one decode and one encode, bounded by the host's upload size cap.
 */
async function renderForModel({ asset, bytes, contentType, imageCodec }: { asset: MediaRecord; bytes: Uint8Array; contentType: string; imageCodec: ImageCodecPort }, _options = {}): Promise<RenderedImage> {
  try {
    const source = Buffer.from(bytes);
    const metadata = await imageCodec.inspect({ source });
    const encoded = await imageCodec.encode({ source, autoOrient: true, format: "webp", quality: WEBP_QUALITY,
      resize: { width: VIEW_IMAGE_MAX_EDGE_PX, height: VIEW_IMAGE_MAX_EDGE_PX, fit: "inside", withoutEnlargement: true } });
    const swap = isQuarterTurn({ orientation: metadata.orientation });
    return {
      data: Buffer.from(encoded.bytes).toString("base64"),
      width: encoded.width,
      height: encoded.height,
      // sharp's `Metadata.width`/`height` are always set for a decodable raster image (typed
      // non-optional), so the original dimensions need no fallback to the encoded output's.
      originalWidth: swap ? metadata.height : metadata.width,
      originalHeight: swap ? metadata.width : metadata.height,
    };
  } catch {
    throw refusal({ message: `media asset '${asset.id}' could not be decoded as an image (${contentType}) — its stored file may be damaged.` });
  }
}

/**
 * Refuses anything that is not a still image, judged by the bytes.
 *
 * @throws {ToolInputError} For a video, or for bytes that are not a raster image type.
 */
function assertStillImage({ asset, contentType }: { asset: MediaRecord; contentType: string }, _optional: Record<string, never> = {}): void {
  if (contentType.startsWith("video/")) {
    throw refusal(
      { message: `media asset '${asset.id}' is a video (${contentType}). This tool only shows still images. Use media_view_video with this mediaId to see sampled video frames.` },
    );
  }
  if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
    throw refusal({ message: `media asset '${asset.id}' is not a viewable image (its stored bytes are ${contentType}).` });
  }
}

/**
 * Builds the tool's registration.
 *
 * @returns One registration: `media_view_image`, read-only.
 */
export function buildMediaViewImageRegistrations(
  { deps, mediaAssetReadToolId, mediaMetadataWriteToolId }: { deps: MediaViewImageToolDeps } & MediaViewImageAgentToolCatalogArgs,
  _optional: Record<string, never> = {},
): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    [MEDIA_VIEW_IMAGE_TOOL_ID]: async (ctx) => {
      const mediaId = requireString({ input: requireInputRecord({ input: ctx.input }), key: "mediaId" });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "media.read" }, { entityType: "media" });

      const asset = await findAsset({ deps, mediaId, mediaAssetReadToolId });
      const bytes = await readStoredBytes({ deps, asset, errorPrefix: "media_view_image" });
      const contentType = sniffContentType({ bytes });
      assertStillImage({ asset, contentType });
      const rendered = await renderForModel({ asset, bytes, contentType, imageCodec: deps.imageCodec });

      const metadata = {
        id: asset.id,
        slug: asset.slug,
        title: asset.title,
        alt: asset.alt,
        caption: asset.caption,
        status: asset.status,
        original: { contentType, width: rendered.originalWidth, height: rendered.originalHeight },
        returned: {
          mimeType: "image/webp",
          width: rendered.width,
          height: rendered.height,
          downscaled: rendered.width < rendered.originalWidth || rendered.height < rendered.originalHeight,
        },
      };
      return {
        content: [
          { type: "text", text: JSON.stringify(metadata) },
          { type: "image", mimeType: "image/webp", data: rendered.data },
        ],
      };
    },
  };

  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "media-view",
    catalogModule: "features/media/view-image-tool.ts",
    catalog: indexCatalogById({ catalog: buildMediaViewImageAgentToolCatalog({ mediaAssetReadToolId, mediaMetadataWriteToolId }) }),
    handlers,
    derivedRisk: mediaViewImageDerivedRisk,
  });
}

/** Contributes the tool to the assistant catalog — installed by `tool-catalog-manifest.ts`. */
export function contributeMediaViewImageTools(
  { mediaAssetReadToolId, mediaMetadataWriteToolId }: MediaViewImageAgentToolCatalogArgs,
  _optional: Record<string, never> = {},
): ToolContributor<MediaViewImageToolDeps, unknown> {
  return { domain: "media-view", build: (deps) => buildMediaViewImageRegistrations({ deps, mediaAssetReadToolId, mediaMetadataWriteToolId }), risk: mediaViewImageDerivedRisk };
}
