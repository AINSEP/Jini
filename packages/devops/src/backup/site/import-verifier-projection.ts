/** The slice of the verified manifest this step reads: the archive's media copies. */
export interface ProjectionManifest { readonly media: readonly { readonly path: string; readonly sha256: string }[] }

/** One media row of the sanitizer's rebuilt database. */
export interface ProjectionMedia { readonly storageKey: string; readonly sha256?: string | undefined; readonly destinationStorageKey?: string | undefined }

/** One Library document row of the sanitizer's rebuilt database. */
export interface ProjectionDocument { readonly storageKey: string; readonly sha256: string; readonly originalFilename: string }

/** The slice of the sanitizer's projection this step reconciles against the archive files. */
export interface ShareProjection { readonly media: readonly ProjectionMedia[]; readonly documents?: readonly ProjectionDocument[] | undefined }

/** The upload policy a Library document must pass; resolves when admitted, throws when refused. */
export type DocumentAdmission = (required: { filename: string; bytes: Buffer }) => Promise<unknown>;

/** Host rules and refusals the projection step cannot own. */
export interface ProjectionDeps {
  /** The share path policy; throws on an unsafe path. */
  validateSharePath(required: { path: string }): void;
  /** Throws the host's archive refusal with this message. */
  refuseArchive: (required: { message: string }) => never;
  sha256Hex(required: { bytes: Buffer }): string;
  /** Builds the host's default document upload policy (bounded document archive reader included). */
  createDocumentAdmission(): DocumentAdmission;
}

/**
 * @file The database half of `verifySiteImport`: after the isolated sanitizer rebuilt the database,
 * reconcile the verified archive files with what that database references. Mutates only the
 * caller's `files` map, and only after every refusal check for that step passed.
 */

/**
 * Prunes excluded blobs, refuses unreferenced uploads, checks every referenced media and document
 * blob, then applies the sanitizer's destination remaps.
 * @throws SiteShareRefusal (INVALID_ARCHIVE, UNSAFE_PATH) or the signal's reason.
 * @complexity O(files + media + documents × document validation).
 */
export async function applyShareProjection(required: { files: Map<string, Buffer>; projection: ShareProjection; manifest: ProjectionManifest; deps: ProjectionDeps }, optional: { signal?: AbortSignal } = {}): Promise<void> {
  const { files, projection, deps } = required;
  const refuseArchive: ProjectionDeps["refuseArchive"] = deps.refuseArchive;
  placeArchiveMedia({ files, projection, manifest: required.manifest, deps });
  const referencedMedia = new Set(projection.media.map(media => "uploads/" + media.storageKey));
  for (const file of files.keys()) if (file.startsWith("uploads/") && !referencedMedia.has(file)) refuseArchive({ message: "Unreferenced uploads are outside the portable share media policy." });
  checkProjectedMedia({ files, projection, deps });
  await admitProjectedDocuments({ files, documents: projection.documents ?? [], deps }, optional);
  applyDestinationMoves({ files, media: projection.media, deps });
}

/** The DB already points at the one public copy; only its portable archive path changes. */
function placeArchiveMedia(required: { files: Map<string, Buffer>; projection: ShareProjection; manifest: ProjectionManifest; deps: ProjectionDeps }): void {
  const { deps } = required;
  const refuseArchive: ProjectionDeps["refuseArchive"] = deps.refuseArchive;
  const byHash = new Map<string, string[]>();
  for (const media of required.projection.media) {
    if (media.sha256) byHash.set(media.sha256, [...(byHash.get(media.sha256) ?? []), media.storageKey]);
  }
  for (const copy of required.manifest.media) {
    const keys = byHash.get(copy.sha256);
    const bytes = required.files.get(copy.path);
    if (!keys || !bytes) refuseArchive({ message: "Archive media is not referenced by the projected database." });
    for (const key of keys) {
      deps.validateSharePath({ path: "uploads/" + key });
      required.files.set("uploads/" + key, bytes);
    }
    required.files.delete(copy.path);
  }
}

function checkProjectedMedia(required: { files: ReadonlyMap<string, Buffer>; projection: ShareProjection; deps: ProjectionDeps }): void {
  const { deps } = required;
  const refuseArchive: ProjectionDeps["refuseArchive"] = deps.refuseArchive;
  const documentKeys = new Set(required.projection.documents?.map(document => document.storageKey));
  for (const media of required.projection.media) {
    deps.validateSharePath({ path: "uploads/" + media.storageKey });
    const content = required.files.get("uploads/" + media.storageKey);
    if (!content || media.sha256 && deps.sha256Hex({ bytes: content }) !== media.sha256) refuseArchive({ message: documentKeys.has(media.storageKey) ? "Referenced document blob is missing or corrupt." : "Referenced media is missing or failed its hash." });
  }
}

/**
 * Every projected Library document must have its exact blob and pass the upload policy.
 * @param optional.admitDocument the upload policy port; defaults to the host's `createDocumentAdmission`
 *   (document ingress validation with a bounded document archive reader).
 */
export async function admitProjectedDocuments(required: { files: ReadonlyMap<string, Buffer>; documents: readonly ProjectionDocument[]; deps: ProjectionDeps }, optional: { signal?: AbortSignal; admitDocument?: DocumentAdmission } = {}): Promise<void> {
  const { deps } = required;
  const refuseArchive: ProjectionDeps["refuseArchive"] = deps.refuseArchive;
  const admitDocument = optional.admitDocument ?? deps.createDocumentAdmission();
  for (const document of required.documents) {
    optional.signal?.throwIfAborted();
    const content = required.files.get("uploads/" + document.storageKey);
    if (!content || deps.sha256Hex({ bytes: content }) !== document.sha256) refuseArchive({ message: "Referenced document blob is missing or corrupt." });
    // A valid outer ZIP checksum cannot grant document admission. Reuse upload policy,
    // including bounded DOCX package validation, before staging or creating the new site.
    try { await admitDocument({ filename: document.originalFilename, bytes: content }); }
    catch (error) { refuseArchive({ message: `Invalid Library document: ${error instanceof Error ? error.message : "document ingress rejected"}` }); }
  }
}

/**
 * The isolated DB owner has already remapped document keys to the new workspace. Move only
 * fully verified bytes, once per source key, and refuse any conflicting destination claim.
 */
function applyDestinationMoves(required: { files: Map<string, Buffer>; media: readonly ProjectionMedia[]; deps: ProjectionDeps }): void {
  const { files, deps } = required;
  const refuseArchive: ProjectionDeps["refuseArchive"] = deps.refuseArchive;
  const moves = new Map(required.media.filter(media => media.destinationStorageKey && media.destinationStorageKey !== media.storageKey).map(media => ["uploads/" + media.storageKey, "uploads/" + media.destinationStorageKey]));
  for (const [source, destination] of moves) {
    deps.validateSharePath({ path: destination });
    const bytes = files.get(source);
    if (bytes === undefined) refuseArchive({ message: "Imported document blob is missing." });
    const existing = files.get(destination);
    if (existing !== undefined && !existing.equals(bytes)) refuseArchive({ message: "Conflicting imported document blob keys." });
    files.set(destination, bytes);
    files.delete(source);
  }
}
