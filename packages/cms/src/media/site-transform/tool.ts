import { toolMetadata } from "@jini-ai/core/tool-metadata/image-transform";
import { buildDomainRegistrations, indexCatalogById, requireInputRecord, withSchemaOnRejection, type AgentToolDefinition, type DerivedRiskByToolId, type ToolContributor, type ToolExecutionContext, type ToolRegistration , type AgentToolSideEffect } from "@jini-ai/core";
import type { AssistantSurfaceDeps, HumanConfirmSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { AssetSourceSchema, AssetTheme, PreparedAssets } from "@jini-ai/core/contracts/site/asset-transfer-tool-ports";
import type { ImageCodecPort } from "@jini-ai/core/contracts/site/cms-media";
import type { AssetDestinationDeps, AssetDestinationKit } from "../../asset-transfer/asset-destinations.js";
import type { AssetBatchApproval, FilesCopyToolDeps } from "../../asset-transfer/copy-tool.js";
import { ImageTransformError, OUTPUT_SCHEMA, IMAGE_LIMITS, inspectImage, normalizeOutputs, renderOutputs, type RenderedImage } from "./image-ops.js";

/**
 * @file `image_transform` — one parameterized tool for every resize/crop/convert job (owner
 * 2026-10-27: tools first, Bash/Python last; generic and flexible). Found live: an assistant
 * building a site generated favicon sizes with Python because no tool did it.
 *
 * Reuses, never re-implements: the source resolves through fs-files' roots and denylist
 * (`asset-sources.ts` + guarded reader); writes go through each destination's existing writer
 * and permission — the picked folder through `fs_write_files`' own batch rules and card, a theme
 * through `writeThemeBinaryFile` + reload, the media library through `uploadMedia`. Historically only the
 * picked folder asked (it leaves the site); theme and media writes are undoable edits. Site paths
 * now use that same batch approval because arbitrary site files lack a downstream validator.
 */

export const IMAGE_TRANSFORM_TOOL_ID = "image_transform";
export interface ImageTransformToolDeps<Theme extends AssetTheme> {
  destination: AssetDestinationDeps<Theme>;
  source: Pick<FilesCopyToolDeps<Theme>["source"], "readAsset">;
  imageCodec: ImageCodecPort;
  readonly refuseUnexpectedKeys: (input: Record<string, unknown>, allowed: readonly string[]) => void;
  isFsShapeRejection: FilesCopyToolDeps<Theme>["isFsShapeRejection"];
  isThemeShapeRejection: FilesCopyToolDeps<Theme>["isThemeShapeRejection"];
  isImportShapeRejection: FilesCopyToolDeps<Theme>["isImportShapeRejection"];
}

export function buildImageTransformAgentToolCatalog(
  { sourceSchema, fsReadPermission }: { sourceSchema: AssetSourceSchema; fsReadPermission: string },
  _optional: Record<string, never> = {},
): AgentToolDefinition[] {
const CATALOG: AgentToolDefinition = {
  name: IMAGE_TRANSFORM_TOOL_ID,
  description: "Resize, crop, rotate, flip and convert ONE image into up to 8 files (png, jpeg, webp, avif, ico) — use this instead of Python/ImageMagick. " +
    "Source: {root, path, themeId?}: site/picked paths, theme-relative assets or media id/slug. No outputs = inspect (width/height/format/bytes), writes nothing. " +
    "Destination: {kind:'site'} (paths relative to site) | {kind:'theme', themeId} | {kind:'media'} (not ico) | {kind:'picked'}. Site/picked writes use the fs_write_files batch approval. " +
    "Recipes — favicon set: [{path:'favicon.ico',format:'ico'},{path:'apple-touch-icon.png',format:'png',resize:{width:180,height:180,fit:'contain'}},{path:'icon-512.png',format:'png',resize:{width:512,height:512,fit:'contain'}}]; " +
    "social image: resize {width:1200,height:630,fit:'cover'}; thumbnail: resize {width:400,fit:'inside'}; to webp: {format:'webp',quality:80}. " +
    `Caps: ${IMAGE_LIMITS.maxDimension}px per side, ${IMAGE_LIMITS.maxInputPixels / 1e6} MP and ${IMAGE_LIMITS.maxSourceBytes / 1024 / 1024} MiB source. Metadata is stripped unless stripMetadata: false.`,
  sideEffects: "mutates-durable-state",
  authorization: { permission: fsReadPermission },
  inputSchema: { type: "object", additionalProperties: false, required: ["source"], properties: {
    source: sourceSchema,
    outputs: { type: "array", minItems: 1, maxItems: IMAGE_LIMITS.maxOutputs, items: OUTPUT_SCHEMA },
    destination: { type: "object", additionalProperties: false, required: ["kind"], properties: { kind: { type: "string", enum: ["site", "theme", "media", "picked"] }, themeId: { type: "string", minLength: 1 } } },
  } },
};
  return [CATALOG];
}

/** -> guarded read + in-memory render; then a theme file, a media item or (carded) picked-folder files. */
export const imageTransformDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([[IMAGE_TRANSFORM_TOOL_ID, "mutates-durable-state"]]);

interface Prepared { source: Awaited<ReturnType<typeof inspectImage>>; rendered: RenderedImage[]; assets?: PreparedAssets<Buffer> }
const isCallerError = <Theme extends AssetTheme>({ error, deps }: { error: unknown; deps: ImageTransformToolDeps<Theme> }, _optional = {}) => {
  if (error instanceof ImageTransformError) return true;
  return deps.isFsShapeRejection({ error }) || deps.isThemeShapeRejection({ error }) || deps.isImportShapeRejection({ error });
};
const view = (rendered: readonly RenderedImage[]) => rendered.map(({ path, format, width, height, bytes }) => ({ path, format, width, height, bytes: bytes.length }));

/** Validate and authorize before I/O; all outputs render before any approval or destination write.
 * @throws Input, permission, decode and writer refusals. @complexity O(outputs × pixels), bounded. */
async function prepare<Theme extends AssetTheme>({ routeDeps, ctx, destinationKit }: { routeDeps: ImageTransformToolDeps<Theme>; ctx: ToolExecutionContext; destinationKit: AssetDestinationKit }): Promise<Prepared> {
  const input = requireInputRecord({ input: ctx.input });
  routeDeps.refuseUnexpectedKeys(input, ["source", "outputs", "destination"]);
  const outputs = input.outputs === undefined ? undefined : normalizeOutputs({ outputs: input.outputs });
  // An inspect needs no destination; it cannot reach a writer.
  const destination = outputs ? await destinationKit.requireAssetDestination({ deps: routeDeps.destination, ctx, input: input.destination }) : undefined;
  const { bytes } = await routeDeps.source.readAsset({ ctx, input: input.source, maxBytes: IMAGE_LIMITS.maxSourceBytes }, {});
  const prepared: Prepared = { source: await inspectImage({ source: bytes, imageCodec: routeDeps.imageCodec }), rendered: outputs ? await renderOutputs({ source: bytes, outputs, imageCodec: routeDeps.imageCodec }) : [] };
  if (destination) prepared.assets = destinationKit.prepareAssetWrites({ deps: routeDeps.destination, destination, files: prepared.rendered });
  return prepared;
}

export function buildImageTransformRegistrations<Theme extends AssetTheme>(
  { deps: routeDeps, surfaces, catalog, approval, destinationKit }: { deps: ImageTransformToolDeps<Theme>; surfaces: HumanConfirmSurfaceDeps; catalog: readonly AgentToolDefinition[]; approval: AssetBatchApproval; destinationKit: AssetDestinationKit },
  _optional: Record<string, never> = {},
): ToolRegistration[] {
  const CATALOG_BY_ID = indexCatalogById({ catalog });
  const handler = approval.approvalToolHandler<Prepared>({ surfaces,
    prepare: ({ ctx }) => withSchemaOnRejection({ toolId: IMAGE_TRANSFORM_TOOL_ID, catalog: CATALOG_BY_ID, isShapeRejection: ({ error }) => isCallerError({ error, deps: routeDeps }), fn: () => prepare({ routeDeps, ctx, destinationKit }) }),
    describe: ({ prepared }) => approval.describeWriteBatch({ batch: prepared.assets?.batch ?? { folder: "", writes: [] }, toolId: IMAGE_TRANSFORM_TOOL_ID }, {}),
    run: async ({ ctx, prepared }) => {
      const base = { source: prepared.source, outputs: view(prepared.rendered) };
      if (!prepared.assets) return { applied: false, ...base };
      const outcome = await destinationKit.writeAssetFiles({ deps: routeDeps.destination, ctx, prepared: prepared.assets });
      return { applied: !("failed" in outcome), ...base, ...outcome };
    },
  }, { flag: "applied", ask: ({ prepared }) => prepared.assets?.batch !== undefined });
  return buildDomainRegistrations({ metadata: toolMetadata, domain: "image-transform", catalogModule: "@jini-ai/cms/media/site-transform/tool",
    catalog: CATALOG_BY_ID, handlers: { [IMAGE_TRANSFORM_TOOL_ID]: handler }, derivedRisk: imageTransformDerivedRisk });
}

/** Contributes `image_transform` — registered once by `tool-catalog-manifest.ts`. */
export function contributeImageTransformTools<D, Theme extends AssetTheme>(
  { catalog, approval, destinationKit, bindDeps }: { catalog: readonly AgentToolDefinition[]; approval: AssetBatchApproval; destinationKit: AssetDestinationKit; bindDeps: (required: { deps: D }, optional?: Record<string, never>) => ImageTransformToolDeps<Theme> },
  _optional: Record<string, never> = {},
): ToolContributor<D, AssistantSurfaceDeps> {
  return { domain: "image-transform", build: (deps, surfaces) => buildImageTransformRegistrations({ deps: bindDeps({ deps }, {}), surfaces, catalog, approval, destinationKit }), risk: imageTransformDerivedRisk };
}
