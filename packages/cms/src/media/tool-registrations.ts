/**
 * @file Media's tool-registration wiring: maps `agent-tools.ts`'s four catalog entries onto
 * `media-service.ts`'s list/upload/update/trash operations, as `ToolRegistration`s. The entire
 * catalog is wired — `purgeMedia` is deliberately absent from the catalog rather than
 * present-but-unwired; see `media/agent-tools.ts`'s own header.
 *
 * Authorization shape: unlike Forms/Identity/Widgets, `media-service.ts`'s functions perform NO
 * internal `authorize()` call of their own — every admin HTTP route a host builds gates inline
 * instead. Every handler here does the same via the kit's `requireToolPermission`, which is the
 * single evaluation for these tools, located where a real route would locate it.
 */
import type { AuthorizeFn } from "../core/commands/command.js";
import {
  buildDomainRegistrations,
  indexCatalogById,
  requireInputRecord,
  requireString,
  requireToolPermission,
  withSchemaOnRejection,
  type AgentToolSideEffect,
  type DerivedRiskByToolId,
  type ToolHandler,
  type ToolRegistration,
} from "../core/tools/registration-kit.js";
import { mediaAgentToolCatalog } from "./agent-tools.js";
import { listMedia, MediaValidationError, trashMedia, updateMediaMetadata, uploadMedia } from "./media-service.js";
import type { AssetBlobRepoPort, AssetRenditionRepoPort, BlobStorePort, MediaRepoPort } from "./ports.js";
import type { MediaRecord } from "./types.js";

const CATALOG_BY_ID = indexCatalogById(mediaAgentToolCatalog);

/**
 * The exact slice of a host's route-deps bag Media's tool handlers read. Declared structurally
 * (rather than importing any host's own route-deps type) so this module carries no back-edge into
 * a host's composition root. A host satisfies this structurally by passing its existing route deps
 * object; nothing there needs to change shape.
 */
export interface MediaToolDeps {
  authorize: AuthorizeFn;
  workspaceId: string;
  clock: { nowIso(): string };
  idGen: { newId(): string };
  mediaRepo: MediaRepoPort;
  assetBlobRepo: AssetBlobRepoPort;
  assetRenditionRepo: AssetRenditionRepoPort;
  blobStore: BlobStorePort;
}

/**
 * This wiring layer's OWN risk classification, authored from what each handler below actually
 * calls. See `DerivedRiskByToolId` in the kit for why it is independent of the catalog's own
 * `sideEffects` declaration.
 */
export const mediaDerivedRisk: DerivedRiskByToolId = new Map<string, AgentToolSideEffect>([
  // -> listMedia (media-service.ts): mediaRepo.list only, no write.
  ["media_list_assets", "none"],
  // -> uploadMedia (media-service.ts): blobRepo.save (maybe) + mediaRepo.save + renditionRepo.save.
  ["media_upload_asset", "mutates-durable-state"],
  // -> updateMediaMetadata (media-service.ts): mediaRepo.save, editorial fields only.
  ["media_update_metadata", "mutates-durable-state"],
  // -> trashMedia (media-service.ts): mediaRepo.save, status flip. Never a purge: purgeMedia is
  //    deliberately not exposed at all (see media/agent-tools.ts's file header).
  ["media_trash_asset", "mutates-durable-state"],
]);

/** The only Media rejection worth decorating with the published schema — a shape problem a different input would fix. */
function isMediaShapeRejection(error: unknown): boolean {
  return error instanceof MediaValidationError;
}

/** What a Media tool returns to the model — see {@link toMediaToolView}. */
interface MediaToolView {
  id: string;
  title: string;
  alt: string;
  caption: string;
  credit: string;
  sha256: string;
  status: MediaRecord["status"];
  version: number;
}

/**
 * Projects a `MediaRecord` into an explicit model-facing shape rather than returning the domain
 * record verbatim — the same discipline Forms' `toFormDefinitionView` applies. `workspaceId`/
 * `createdAt`/`updatedAt` are dropped for the identical reasons given there.
 */
function toMediaToolView(record: MediaRecord): MediaToolView {
  return {
    id: record.id,
    title: record.title,
    alt: record.alt,
    caption: record.caption,
    credit: record.credit,
    sha256: record.source.sha256,
    status: record.status,
    version: record.version,
  };
}

export function buildMediaRegistrations(routeDeps: MediaToolDeps): ToolRegistration[] {
  const mediaWriteDeps = () => ({
    clock: routeDeps.clock,
    idGen: routeDeps.idGen,
    mediaRepo: routeDeps.mediaRepo,
    blobRepo: routeDeps.assetBlobRepo,
    renditionRepo: routeDeps.assetRenditionRepo,
    blobStore: routeDeps.blobStore,
  });

  const handlers: Record<string, ToolHandler> = {
    media_list_assets: async (ctx) => {
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "media.read", entityType: "media" });
      const { media } = await listMedia({ deps: { mediaRepo: routeDeps.mediaRepo }, input: { workspaceId: routeDeps.workspaceId } });
      return { media: media.map(toMediaToolView) };
    },

    media_upload_asset: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "media.upload", entityType: "media" });
      return withSchemaOnRejection({ toolId: "media_upload_asset", catalog: CATALOG_BY_ID, isShapeRejection: isMediaShapeRejection }, async () => {
        const dataBase64 = requireString(input, "dataBase64");
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(Buffer.from(dataBase64, "base64"));
        } catch {
          throw new Error("'dataBase64' is not valid base64");
        }
        const { media } = await uploadMedia({
          deps: mediaWriteDeps(),
          input: {
            workspaceId: routeDeps.workspaceId,
            bytes,
            filename: requireString(input, "filename"),
            contentType: requireString(input, "contentType"),
            alt: typeof input.alt === "string" ? input.alt : undefined,
            caption: typeof input.caption === "string" ? input.caption : undefined,
            credit: typeof input.credit === "string" ? input.credit : undefined,
            createdByPrincipal: ctx.principal.id,
          },
        });
        return { media: toMediaToolView(media) };
      });
    },

    media_update_metadata: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      const mediaId = requireString(input, "mediaId");
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "media.update", entityType: "media", entityId: mediaId });
      const { media } = await updateMediaMetadata({
        deps: { clock: routeDeps.clock, mediaRepo: routeDeps.mediaRepo },
        input: {
          workspaceId: routeDeps.workspaceId,
          id: mediaId,
          title: typeof input.title === "string" ? input.title : undefined,
          alt: typeof input.alt === "string" ? input.alt : undefined,
          caption: typeof input.caption === "string" ? input.caption : undefined,
          credit: typeof input.credit === "string" ? input.credit : undefined,
        },
      });
      return { media: toMediaToolView(media) };
    },

    media_trash_asset: async (ctx) => {
      const mediaId = requireString(requireInputRecord(ctx.input), "mediaId");
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "media.delete", entityType: "media", entityId: mediaId });
      const { media } = await trashMedia({
        deps: { clock: routeDeps.clock, mediaRepo: routeDeps.mediaRepo },
        input: { workspaceId: routeDeps.workspaceId, id: mediaId },
      });
      return { media: toMediaToolView(media) };
    },
  };

  // No `unwiredToolIds`: Media wires its ENTIRE catalog, same tripwire discipline as Forms.
  return buildDomainRegistrations({
    domain: "media",
    catalogModule: "media/agent-tools.ts",
    catalog: CATALOG_BY_ID,
    handlers,
    derivedRisk: mediaDerivedRisk,
  });
}
