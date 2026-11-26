
import type { ArchiveMediaCopy, ArchiveMediaSource } from "../archive-media.js";

import { sql } from "kysely";

import { SiteShareRefusal, archiveRefusalName } from "../share-refusal.js";

import type { Row, Kernel, ShareDatabaseProjection, sanitizeShareDatabase } from "./projection.js";

/** Omitted media loses its rows, sidecars and application-owned links in the fresh projection.
 * Sidecars use the retained-owner index below; posts retain their content with no featured image.
 */
export function omitMediaReferences(required: { row: Row; table: string; omitted: ReadonlySet<string> }, _options = {}): Row | null {
  const { row, table, omitted } = required;
  if (table === "media" && omitted.has(String(row.id))) return null;
  if (table === "posts" && omitted.has(String(row.featured_media_id))) return { ...row, featured_media_id: null };
  if (table === "entry_refs" && row.target_kind === "media" && omitted.has(String(row.target_id))) return null;
  return row;
}

const SIDECAR_TABLES: readonly string[] = ["media_slug_history", "asset_blobs", "asset_renditions"];

/** Who owns which bytes, from the retained (already projected) `media` rows. */
interface MediaOwners {
  readonly byId: ReadonlyMap<string, Row>;
  readonly byHash: ReadonlyMap<string, { document: boolean; media: boolean }>;
  /** Blob keys only a document owns: no active public-media owner shares the bytes. */
  readonly privateKeys: ReadonlySet<string>;
}

/** Workspace-scoped identity key for an owner lookup. O(1). */
function ownerKey({ workspace, identity }: { workspace: unknown; identity: unknown }, _optional: Record<string, never> = {}): string {
  return JSON.stringify([workspace, identity]);
}

/** Select sidecars from retained editorial owners, never the filesystem or orphan blobs.
 * One bounded owner scan per sidecar table, then O(1) lookup per row; O(media rows) space.
 * Document ownership is sticky even when an active public-media owner shares the bytes.
 */
export async function mediaRowProjection(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  target: Kernel; table: string }, _options: Record<string, never> = {}): Promise<(row: Row) => Row | null> {
  if (required.table === "media") return projectMediaRow;
  if (!SIDECAR_TABLES.includes(required.table)) return row => row;
  const owners = indexMediaOwners({ host: required.host, owners: await required.target.run(db => db.selectFrom("media").selectAll().execute()) });
  if (required.table === "asset_blobs") return row => projectAssetBlob({ row, owners });
  const ownerColumn = required.table === "media_slug_history" ? "media_id" : "asset_id";
  return row => {
    const owner = owners.byId.get(ownerKey({ workspace: row.workspace_id, identity: row[ownerColumn] }));
    if (!owner) return null;
    return required.table === "asset_renditions" ? projectRendition({ host: required.host, row, owner, privateKeys: owners.privateKeys }) : row;
  };
}

/** Ordinary media travels as is; an active document loses its uploader; any other document drops.
 * @throws SiteShareRefusal INVALID_DOCUMENT for a kind other than media/document. O(1). */
function projectMediaRow(row: Row): Row | null {
  if (row.kind !== "media" && row.kind !== "document") throw new SiteShareRefusal({ code: "INVALID_DOCUMENT", message: "Unsupported media kind in share database." });
  if (row.kind === "media") return row;
  return row.status === "active" ? { ...row, created_by: null } : null;
}

/** Indexes the retained media rows by id and by content hash, and derives document-only blob keys.
 * O(media rows) time and space. */
function indexMediaOwners(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  owners: Row[] }, _options: Record<string, never> = {}): MediaOwners {
  const byId = new Map(required.owners.map(row => [ownerKey({ workspace: row.workspace_id, identity: row.id }), row]));
  const byHash = new Map<string, { document: boolean; media: boolean }>();
  for (const row of required.owners) {
    const hash = ownerKey({ workspace: row.workspace_id, identity: row.source_sha256 });
    const kinds = byHash.get(hash) ?? { document: false, media: false };
    if (row.kind === "document") kinds.document = true;
    else if (row.status === "active") kinds.media = true;
    else {
      // Inactive non-document owners do not grant public media ownership.
    }
    byHash.set(hash, kinds);
  }
  const privateKeys = new Set(required.owners.filter(row => row.kind === "document" && !byHash.get(ownerKey({ workspace: row.workspace_id, identity: row.source_sha256 }))?.media)
    .map(row => required.host.computeBlobStorageKey({ workspaceId: String(row.workspace_id), sha256: String(row.source_sha256) })));
  return { byId, byHash, privateKeys };
}

/** A blob travels only with a retained owner of its bytes; document bytes stay marked share-owned. O(1). */
function projectAssetBlob(required: { row: Row; owners: MediaOwners }, _options: Record<string, never> = {}): Row | null {
  const kinds = required.owners.byHash.get(ownerKey({ workspace: required.row.workspace_id, identity: required.row.sha256 }));
  if (!kinds) return null;
  return { ...required.row, ...(kinds.document || required.row.document_owned === 1 ? { document_owned: 1, created_by_principal: "share" } : {}) };
}

/** A rendition of a retained owner: ordinary owners may not reach document-only bytes; a document
 * keeps only its `original`, which must be its own source blob. O(1).
 * @throws SiteShareRefusal INVALID_DOCUMENT for either forged reference. */
function projectRendition(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  row: Row; owner: Row; privateKeys: ReadonlySet<string> }, _options: Record<string, never> = {}): Row | null {
  const { row, owner } = required;
  // A public rendition must never borrow a document-only source, even across owners.
  // Check before the import worker remaps keys and loses the source ownership boundary.
  if (owner.kind !== "document") {
    if (required.privateKeys.has(String(row.storage_key))) throw new SiteShareRefusal({ code: "INVALID_DOCUMENT", message: "Ordinary rendition references a private document blob." });
    return row;
  }
  if (row.transform_name !== "original") return null;
  if (row.storage_key !== required.host.computeBlobStorageKey({ workspaceId: String(owner.workspace_id), sha256: String(owner.source_sha256) })) throw new SiteShareRefusal({ code: "INVALID_DOCUMENT", message: "Document original rendition has an invalid blob key." });
  return row;
}

/** Validate document identity against its retained blob before reading bytes through storage.
 * O(media + blob rows) time/space; missing/corrupt document references explicitly refuse.
 */
export async function documentReferences(required: { host: Parameters<typeof sanitizeShareDatabase>[0]["host"];  target: Kernel }, _options: Record<string, never> = {}): Promise<NonNullable<ShareDatabaseProjection["documents"]>> {
  const blobs = await required.target.run(db => db.selectFrom("asset_blobs").selectAll().execute());
  const byHash = new Map(blobs.map(row => [ownerKey({ workspace: row.workspace_id, identity: row.sha256 }), row]));
  const documents = await required.target.run(db => db.selectFrom("media").selectAll().where("kind", "=", "document").execute());
  return documents.map(row => {
    const sha256 = String(row.source_sha256);
    const blob = byHash.get(ownerKey({ workspace: row.workspace_id, identity: row.source_sha256 }));
    const storageKey = required.host.computeBlobStorageKey({ workspaceId: String(row.workspace_id), sha256 });
    const invalidBlob = !/^[a-f0-9]{64}$/.test(sha256) || !blob || blob.storage_key !== storageKey || blob.status !== "active";
    if (invalidBlob || typeof row.original_filename !== "string") throw new SiteShareRefusal({ code: "INVALID_DOCUMENT", message: "Document source blob is missing or has an invalid key/hash." });
    required.host.documentContentType({ filename: row.original_filename });
    return { storageKey, sha256, originalFilename: row.original_filename };
  });
}

/** Snapshot metadata for the archive selector. Three bulk reads, then indexed lookups per item. */
export async function archiveMediaSources({ target }: { target: Kernel }): Promise<ArchiveMediaSource[]> {
  const rows = await target.run(db => db.selectFrom("media").selectAll().execute());
  const blobs = await target.run(db => db.selectFrom("asset_blobs").selectAll().execute());
  const renditions = await target.run(db => db.selectFrom("asset_renditions").selectAll().where("transform_name", "=", "public").execute());
  const transforms = await target.run(db => db.selectFrom("transform_registry").selectAll().where("name", "=", "public").orderBy("version", "asc").execute());
  const byHash = new Map(blobs.map(row => [ownerKey({ workspace: row.workspace_id, identity: row.sha256 }), row]));
  const byKey = new Map(blobs.map(row => [String(row.storage_key), row]));
  const definitions = new Map(transforms.map(row => [String(row.workspace_id), row]));
  const publics = new Map(renditions.map(row => [ownerKey({ workspace: row.workspace_id, identity: [row.asset_id, row.version] }), row]));
  return rows.map(row => {
    const blob = byHash.get(ownerKey({ workspace: row.workspace_id, identity: row.source_sha256 }));
    if (!blob) throw new SiteShareRefusal({ code: "MISSING_MEDIA", message: `Media '${archiveRefusalName({ name: String(row.id) })}' has no source blob.` });
    const definition = definitions.get(String(row.workspace_id));
    const rendition = definition && publics.get(ownerKey({ workspace: row.workspace_id, identity: [row.id, definition.version] }));
    return { id: String(row.id), workspaceId: String(row.workspace_id), slug: String(row.slug ?? row.id), kind: String(row.kind),
      originalFilename: row.original_filename === null ? null : String(row.original_filename), storageKey: String(blob.storage_key), sha256: String(blob.sha256), documentOwned: Boolean(blob.document_owned),
      ...(definition ? { public: { version: Number(definition.version), params: JSON.parse(String(definition.params_json)),
        ...(rendition ? { storageKey: String(rendition.storage_key), sha256: renditionHash({ key: String(rendition.storage_key), blob: byKey.get(String(rendition.storage_key)) }) } : {}) } } : {}) };
  });
}

export async function rewriteMediaRows(required: { target: Kernel; copies: readonly ArchiveMediaCopy[] }, optional: { signal?: AbortSignal }): Promise<void> {
  const { target } = required;
  const media = await target.run(db => db.selectFrom("media").selectAll().execute());
  const byId = new Map(media.map(row => [ownerKey({ workspace: row.workspace_id, identity: row.id }), row]));
  const blobs = await target.run(db => db.selectFrom("asset_blobs").selectAll().execute());
  const byHash = new Map(blobs.map(row => [ownerKey({ workspace: row.workspace_id, identity: row.sha256 }), row]));
  if (byId.size !== required.copies.length) throw new SiteShareRefusal({ code: "INVALID_MEDIA", message: "Archive media does not cover the snapshot." });
  await target.transaction(async () => {
    await target.run(db => db.deleteFrom("asset_renditions").execute());
    await target.run(db => db.deleteFrom("asset_blobs").execute());
    for (const copy of required.copies) {
      optional.signal?.throwIfAborted();
      const row = byId.get(ownerKey({ workspace: copy.workspaceId, identity: copy.id }));
      if (!row) throw new SiteShareRefusal({ code: "INVALID_MEDIA", message: "Unknown archive media item." });
      await target.run(db => db.updateTable("media").set({ source_sha256: copy.sha256 }).where("id", "=", copy.id).where("workspace_id", "=", copy.workspaceId).execute());
      await target.run(db => db.insertInto("asset_blobs").values(archiveBlobRow({ copy, media: row, existing: byHash.get(ownerKey({ workspace: copy.workspaceId, identity: copy.sha256 })) }))
        .onConflict(oc => oc.columns(["workspace_id", "sha256"]).doUpdateSet({ document_owned: sql`max(document_owned, excluded.document_owned)` })).execute());
      for (const rendition of [{ name: "original", version: 1 }, ...(copy.publicVersion === undefined ? [] : [{ name: "public", version: copy.publicVersion }])]) {
        await target.run(db => db.insertInto("asset_renditions").values({ id: copy.id + ":" + rendition.name, workspace_id: copy.workspaceId, asset_id: copy.id, transform_name: rendition.name, version: rendition.version, storage_key: copy.storageKey, created_at: row.created_at }).execute());
      }
    }
  });
}

/** Preserve unchanged blob metadata and sticky document privacy while replacing its path/hash. */
function archiveBlobRow(required: { copy: ArchiveMediaCopy; media: Row; existing?: Row }): Row {
  const { copy, media } = required;
  const original: Row = required.existing ?? { id: copy.workspaceId + ":" + copy.sha256, created_by_principal: "share", created_at: media.created_at, status: "active", tombstoned_at: null };
  const documentOwned = Boolean(copy.documentOwned || media.kind === "document" || original.document_owned);
  const contentType = copy.contentType === "application/octet-stream" ? original.content_type ?? copy.contentType : copy.contentType;
  return { ...original, workspace_id: copy.workspaceId, sha256: copy.sha256, storage_key: copy.storageKey, content_type: contentType, document_owned: documentOwned ? 1 : 0 };
}

function renditionHash(required: { key: string; blob: Row | undefined }): string | undefined {
  if (typeof required.blob?.sha256 === "string") return required.blob.sha256;
  return /[a-f0-9]{64}$/.exec(required.key)?.[0];
}