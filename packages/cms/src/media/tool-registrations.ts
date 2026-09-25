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
 *
 * `publicUrl` (2026-09-02, closing the same capability gap `features/post/tool-registrations.ts`'s
 * own `publicUrl` addition closed there: an agent could upload/list an asset but had no tool-facing
 * way to learn a URL usable to embed it in a post/page). Unlike `post`, this package has no host to
 * resolve a public URL against — the `/m/{assetId}/{transformName}.v{version}/...` contract
 * (ADR-027 §4) is a HOST decision (which URL prefix, which transform pipeline, whether one even
 * exists), not a `@jini-ai/cms` one; this package deliberately has zero `/m/`-shaped string
 * literals anywhere. So `publicUrl` is resolved through an OPTIONAL, host-injected
 * {@link MediaToolDeps.resolvePublicUrls}, batch-shaped (one call per `media_list_assets`/
 * `media_upload_asset` invocation, not one per asset) so a host backing it with a real lookup
 * (content-type/blob-store reads) never pays N queries for an N-row list. A host that omits it gets
 * today's exact behavior unchanged — `publicUrl` simply never appears on the response, which is why
 * this stays additive rather than a breaking change to every existing consumer of this file.
 *
 * Deliberately NOT added to `media_update_metadata`/`media_trash_asset` — mirrors
 * `features/post/tool-registrations.ts`'s identical reasoning for skipping `content_post_update`/
 * `content_post_delete`: those two return the row incidentally, to confirm what was just
 * edited/trashed, not to answer "where does this live".
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
import { listMedia, MediaValidationError, rollbackUploadedMedia, trashMedia, updateMediaMetadata, uploadMedia } from "./media-service.js";
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
  /**
   * Optional, batch-shaped resolver for each listed asset's host-served public URL — see this
   * file's header, "`publicUrl`". Called with every asset `media_list_assets`/`media_upload_asset`
   * is about to return, at most once per tool call; the returned map's key is `MediaRecord.id`, and
   * a missing/`null` entry means "no public URL for this asset" (e.g. trashed, or the host's own
   * resolution failed soft). Omitted entirely: every response's `publicUrl` is `null`, matching this
   * field's own pre-2026-09-02 absence for every host that has not opted in yet.
   */
  resolvePublicUrls?: (assets: readonly MediaRecord[]) => Promise<ReadonlyMap<string, string | null>>;
  /**
   * Optional hook run once, right after `media_upload_asset`'s own `uploadMedia()` call succeeds —
   * the fix for a defect where a tool-driven upload recorded NO content type anywhere. `uploadMedia`
   * (`media-service.ts`) validates the caller's `contentType` string against an advisory allowlist
   * and then discards it by design (see that file's own header) — neither `AssetBlobRecord` nor
   * `MediaRecord` has a field for it, so this package cannot persist one itself. A host that wants
   * one recorded (e.g. so an admin "Images"/"Videos" filter or a public rendition route can answer
   * "what type is this blob") wires this hook to its own content-type store, exactly the same
   * pattern {@link resolvePublicUrls} already established for `publicUrl`.
   *
   * Deliberately given the RAW UPLOADED BYTES, not the caller's declared `contentType` string: a
   * host is expected to derive the real type from bytes (a magic-byte sniff), never trust the
   * declared string outright — the same "an attacker-controlled `contentType` header is trusted,
   * which the real ingress policy would never do" gap `uploadMedia`'s own header already discloses
   * for the validation step. This hook is this package's only chance to hand a host those bytes
   * before they go out of scope; asking a host to re-read them later would mean either persisting
   * the client-declared string untrusted (the exact gap this hook exists to avoid) or a second blob
   * read the host does not otherwise need.
   *
   * Any rejection from this hook propagates out of the `media_upload_asset` handler uncaught — a
   * failure to record the type is a real failure, not swallowed to report a false success (mirrors
   * `resolveCredentialForProvider`'s "never silently fall through" discipline elsewhere in this
   * package's siblings). Before rethrowing, the handler calls `rollbackUploadedMedia`
   * (`media-service.ts`) to remove the rendition + media rows `uploadMedia()` just wrote (and
   * tombstone the blob if unreferenced) — the fix for the sibling defect where those rows survived
   * as orphans even though the caller saw the upload as failed. Omitted entirely: never called,
   * matching this field's own pre-fix absence for every host that has not opted in yet — the exact
   * `resolvePublicUrls`-precedent contract.
   */
  recordUploadContentType?: (params: { media: MediaRecord; bytes: Uint8Array }) => Promise<void>;
  /**
   * Optional host-supplied override of `uploadMedia`'s own `DEFAULT_MAX_UPLOAD_BYTES` (10 MiB,
   * `media-service.ts`), forwarded verbatim as `uploadMedia`'s third (`optional`) argument in the
   * `media_upload_asset` handler below (2026-09-21). Before this field existed, the handler called
   * `uploadMedia({ deps, input })` with no third argument at all, so EVERY host's assistant upload
   * tool was hard-capped at 10 MiB regardless of what limit that host's own HTTP upload route
   * enforced — a host raising its own cap (e.g. to 50 MiB) had no way to raise this tool's cap to
   * match. Omitted: `uploadMedia`'s own default applies unchanged, matching this field's own
   * pre-2026-09-21 absence for every host that has not opted in yet — the same degrade-soft
   * contract {@link resolvePublicUrls} and {@link recordUploadContentType} already established.
   */
  maxUploadBytes?: number;
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
  /** The asset's short lookup name (2026-09-16) — a page marker can reference this instead of the
   *  long `id`; see `media_update_metadata`'s `slug` field for how to change it. */
  slug: string;
  title: string;
  alt: string;
  caption: string;
  credit: string;
  sha256: string;
  status: MediaRecord["status"];
  version: number;
  /** Asset-wide presentation overrides (2026-09-16) — see `media_update_metadata`'s own schema doc
   *  for why these are readable here: a model must see the CURRENT value before it can safely
   *  replace it (`htmlAttributes`/`cssClass` are whole-value replaces, not patches). */
  cssClass: string | null;
  htmlAttributes: string | null;
}

/**
 * Projects a `MediaRecord` into an explicit model-facing shape rather than returning the domain
 * record verbatim — the same discipline Forms' `toFormDefinitionView` applies. `workspaceId`/
 * `createdAt`/`updatedAt` are dropped for the identical reasons given there.
 */
function toMediaToolView(record: MediaRecord): MediaToolView {
  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    alt: record.alt,
    caption: record.caption,
    credit: record.credit,
    sha256: record.source.sha256,
    status: record.status,
    version: record.version,
    cssClass: record.cssClass,
    htmlAttributes: record.htmlAttributes,
  };
}

/** {@link MediaToolView} plus the resolved public URL — see this file's header ("`publicUrl`") for
 *  why this is a separate type rather than a field added to the base shape. */
interface MediaToolViewWithPublicUrl extends MediaToolView {
  publicUrl: string | null;
}

/**
 * Batch-resolves `publicUrl` for every listed asset via {@link MediaToolDeps.resolvePublicUrls},
 * then projects each into {@link MediaToolViewWithPublicUrl}. A single call regardless of
 * `records.length` — see this file's header for why this is batch-shaped rather than per-asset.
 * When `routeDeps.resolvePublicUrls` is not provided, every row's `publicUrl` is `null` (the field
 * still appears — the caller always gets the same shape back, only the value differs).
 *
 * @complexity O(1) beyond the injected resolver's own cost (documented as its own caller's
 * responsibility — see `MediaToolDeps.resolvePublicUrls`'s own doc).
 */
async function toMediaToolViewsWithPublicUrls(routeDeps: MediaToolDeps, records: readonly MediaRecord[]): Promise<MediaToolViewWithPublicUrl[]> {
  const urls = routeDeps.resolvePublicUrls ? await routeDeps.resolvePublicUrls(records) : new Map<string, string | null>();
  return records.map((record) => ({ ...toMediaToolView(record), publicUrl: urls.get(record.id) ?? null }));
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
      return { media: await toMediaToolViewsWithPublicUrls(routeDeps, media) };
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
        }, { maxUploadBytes: routeDeps.maxUploadBytes });
        if (routeDeps.recordUploadContentType) {
          try {
            await routeDeps.recordUploadContentType({ media, bytes });
          } catch (err) {
            // The blob/media/rendition rows uploadMedia() just wrote must not survive as orphans
            // when the caller is about to see this whole upload as failed (the fix for that gap —
            // see rollbackUploadedMedia's own doc). The original hook error is rethrown unchanged.
            await rollbackUploadedMedia({
              deps: {
                mediaRepo: routeDeps.mediaRepo,
                blobRepo: routeDeps.assetBlobRepo,
                renditionRepo: routeDeps.assetRenditionRepo,
                clock: routeDeps.clock,
              },
              input: { workspaceId: routeDeps.workspaceId, media },
            });
            throw err;
          }
        }
        const [view] = await toMediaToolViewsWithPublicUrls(routeDeps, [media]);
        return { media: view };
      });
    },

    media_update_metadata: async (ctx) => {
      const input = requireInputRecord(ctx.input);
      const mediaId = requireString(input, "mediaId");
      await requireToolPermission(routeDeps, { principalId: ctx.principal.id, permission: "media.update", entityType: "media", entityId: mediaId });
      return withSchemaOnRejection({ toolId: "media_update_metadata", catalog: CATALOG_BY_ID, isShapeRejection: isMediaShapeRejection }, async () => {
        const { media } = await updateMediaMetadata({
          deps: { clock: routeDeps.clock, mediaRepo: routeDeps.mediaRepo },
          input: {
            workspaceId: routeDeps.workspaceId,
            id: mediaId,
            title: typeof input.title === "string" ? input.title : undefined,
            alt: typeof input.alt === "string" ? input.alt : undefined,
            caption: typeof input.caption === "string" ? input.caption : undefined,
            credit: typeof input.credit === "string" ? input.credit : undefined,
            slug: typeof input.slug === "string" ? input.slug : undefined,
            cssClass: typeof input.cssClass === "string" ? input.cssClass : undefined,
            htmlAttributes: typeof input.htmlAttributes === "string" ? input.htmlAttributes : undefined,
          },
        });
        return { media: toMediaToolView(media) };
      });
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
