import { createHash } from "node:crypto";
import { SiteShareRefusal } from "./share-refusal.js";
import type { CredentialWarning } from "./credential-warnings.js";
import { sharePathAlias, type PackageFileInventory, type ShareFilePolicy } from "./share-file-policy.js";
import { ARCHIVE_MANIFEST_PATH as SITE_BACKUP_MANIFEST_PATH, ARCHIVE_DATABASE_PATH as SITE_BACKUP_DATABASE_PATH, requireArchiveFileRecord, type ArchiveManifest, type ArchivePlugin, type ArchiveSchemaIdentity } from "./archive-manifest.js";
import { SAVED_KEYS_PATH } from "./saved-keys-port.js";
import { isStaticSitePath } from "./static-copy.js";
import type { AgentPluginArchiveEntry, AgentPluginArchiveReaderPort } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";

/**
 * @file The archive half of `verifySiteImport`: the metadata-only first pass, the manifest contract,
 * the manifest inventory, and the bounded, hash-checked second pass. Every refusal here is
 * `INVALID_ARCHIVE` unless a shared share policy (path, limits, secrets) refuses first.
 */

type FileEntry = Extract<AgentPluginArchiveEntry, { kind: "file" }>;

/** One manifest file record after validation: the exact bytes and hash the archive must match. */
export interface InventoryRecord { readonly path: string; readonly bytes: number; readonly sha256: string }

/** A manifest that passed the share identity contract; only the fields later steps read are typed. */
export type SupportedShareManifest = ArchiveManifest;

/** What the metadata pass learned, before any listed content is read. */
export interface ArchiveScan {
  readonly manifestBytes: Buffer;
  readonly wrapper: string;
  /** Case/Unicode alias of every file entry, the manifest included. */
  readonly fileAliases: Set<string>;
  readonly directories: Set<string>;
}

/** The per-archive claim sets the first pass fills in place. */
interface EntryClaims {
  readonly aliases: Map<string, string>;
  readonly fileAliases: Set<string>;
  readonly directories: Set<string>;
  readonly sizes: { path: string; bytes: number }[];
}

/**
 * What the host owns: the caps, the share path/secret rules, the manifest codec, the code-unit and
 * scan-path mappings, the portable inventory layout and the sentence for a changed file. Every member is REQUIRED.
 */
export interface ImportInventoryHost extends Pick<ShareFilePolicy, "validateSharePath" | "excludedSharePath" | "requireShareSecretFree" | "claimSharePath"> {
  readonly limits: { readonly maxFiles: number; readonly maxManifestBytes: number; readonly maxExpandedBytes: number };
  /** Roots a manifest file record may name, e.g. `/^(?:media|themes)\/.+/`. */
  readonly inventoryRoots: RegExp;
  /** Root-level files a manifest may list besides the roots. */
  readonly settingsFiles: readonly string[];
  /** The plain sentence shown for a file whose contents no longer match what was exported. */
  readonly changedArchiveMessage: string;
  checkShareLimits(required: { files: readonly { path: string; bytes: number }[] }): void;
  parseArchiveManifest(required: { bytes: Buffer; schema: ArchiveSchemaIdentity }): ArchiveManifest;
  /** The unit that must stay off when any of its bytes were edited, or `undefined` for non-code. */
  archiveCodeUnit(required: { path: string }): string | undefined;
  /** The scanner's runtime-shaped path for an archive path. */
  archiveSecretScanPath(required: { path: string; plugins: readonly ArchivePlugin[] }): string;
}

export function refuseArchive({ message }: { message: string }, _optional: Record<string, never> = {}): never { throw new SiteShareRefusal({ code: "INVALID_ARCHIVE", message }); }

/** Hex SHA-256 of a whole buffer. O(bytes). */
export function sha256Hex({ bytes }: { bytes: Buffer }, _optional: Record<string, never> = {}): string { return createHash("sha256").update(bytes).digest("hex"); }

/**
 * First pass, metadata only: refuses links/special entries and enforces the entry cap, reads only
 * the one manifest (bounded), then claims every entry path, refusing collisions, invalid declared
 * sizes and the declared-size caps. ZIP ordering is never trusted; the manifest may appear anywhere.
 * @throws SiteShareRefusal (INVALID_ARCHIVE, UNSAFE_PATH, LIMIT_EXCEEDED) or the signal's reason.
 * @complexity O(entries × path depth + manifest bytes), at most 2,000 entries.
 */
export async function scanArchiveMetadata(required: { archive: Buffer; reader: AgentPluginArchiveReaderPort; host: ImportInventoryHost }, optional: { signal?: AbortSignal } = {}): Promise<ArchiveScan> {
  const claims: EntryClaims = { aliases: new Map(), fileAliases: new Set(), directories: new Set(), sizes: [] };
  const entries: AgentPluginArchiveEntry[] = [];
  let count = 0;
  for await (const entry of required.reader.entries({ archive: required.archive })) {
    optional.signal?.throwIfAborted();
    count++;
    if (count > required.host.limits.maxFiles) refuseArchive({ message: "Import exceeds the 2,000-entry cap." });
    const name = entry.entryPath.replace(/\/$/, "");
    validateRawEntry({ entry, name, host: required.host });
    if (!ignoredArchivePath({ path: name })) entries.push(entry);
  }
  const wrapper = sharedWrapperFolder({ entries });
  const manifestBytes = await readManifest({ archive: required.archive, reader: required.reader, maxBytes: required.host.limits.maxManifestBytes, path: wrapper + SITE_BACKUP_MANIFEST_PATH }, optional);
  claimNormalizedEntries({ entries, claims, wrapper, host: required.host });
  return { manifestBytes, wrapper, fileAliases: claims.fileAliases, directories: claims.directories };
}

/**
 * The Finder wrapper is the one top-level folder that holds every entry; any root file (the root
 * manifest included) or a second top-level folder means there is no wrapper. Deciding it from the
 * whole tree, never from where a `manifest.json` sits, keeps a media file named `manifest.json`
 * from passing for a wrapped manifest. O(entries).
 */
function sharedWrapperFolder(required: { entries: readonly AgentPluginArchiveEntry[] }): string {
  const tops = new Set(required.entries.map(entry => {
    const parts = entry.entryPath.replace(/\/$/, "").split("/");
    return parts.length > 1 || entry.kind === "directory" ? parts[0] : "";
  }));
  const [top] = tops;
  return tops.size === 1 && top ? top + "/" : "";
}

/** A separate pass for the manifest alone: the reader closes the ZIP when an iteration ends, so
 * the bounded read must be awaited inside it before iterator cleanup closes the stream. */
async function readManifest(required: { archive: Buffer; reader: AgentPluginArchiveReaderPort; path: string; maxBytes: number }, optional: { signal?: AbortSignal }): Promise<Buffer> {
  for await (const entry of required.reader.entries({ archive: required.archive })) {
    optional.signal?.throwIfAborted();
    if (entry.kind === "file" && entry.entryPath === required.path) return await readBounded({ entry, maxBytes: required.maxBytes, signal: optional.signal });
  }
  return refuseArchive({ message: "A v2 manifest.json at root, or inside one wrapper folder with nothing outside it, is required." });
}

/** Finder metadata is discarded identically in both passes, without decompressing it. */
export function ignoredArchivePath(required: { path: string }, _optional = {}): boolean {
  return required.path.split("/").some(part => part === "__MACOSX" || part === ".DS_Store");
}
function stripArchiveWrapper(required: { path: string; wrapper: string; host: ImportInventoryHost }): string {
  if (!required.path.startsWith(required.wrapper)) refuseArchive({ message: "Files outside the single wrapper folder are forbidden." });
  const path = required.path.slice(required.wrapper.length);
  required.host.validateSharePath({ path: path.replace(/\/$/, "") });
  return path;
}

/** Claims one entry; returns it when it is a file, `undefined` for a directory. */
function claimEntry(required: { claims: EntryClaims; entry: AgentPluginArchiveEntry; host: ImportInventoryHost }): FileEntry | undefined {
  const { claims, entry, host } = required;
  if (entry.kind !== "file" && entry.kind !== "directory") refuseArchive({ message: "ZIP links and special entries are forbidden." });
  if (entry.kind === "directory") {
    claimDirectory({ claims, name: entry.entryPath.replace(/\/$/, ""), host });
    return undefined;
  }
  claimFile({ claims, entry, host });
  return entry;
}

function claimDirectory(required: { claims: EntryClaims; name: string; host: ImportInventoryHost }): void {
  const { claims, name } = required;
  required.host.claimSharePath({ path: name, directory: true, aliases: claims.aliases, files: claims.fileAliases });
  if (claims.directories.has(name) || claims.fileAliases.has(sharePathAlias({ path: name }))) refuseArchive({ message: "Duplicate directory or file/directory collision." });
  claims.directories.add(name);
}

function claimFile(required: { claims: EntryClaims; entry: FileEntry; host: ImportInventoryHost }): void {
  const { claims, entry } = required;
  const name = entry.entryPath;
  required.host.claimSharePath({ path: name, directory: false, aliases: claims.aliases, files: claims.fileAliases });
  if (claims.directories.has(name)) refuseArchive({ message: "ZIP file/directory collision." });
  const size = entry.declaredSize;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) refuseArchive({ message: "ZIP has an invalid declared size." });
  claims.sizes.push({ path: name, bytes: size });
  required.host.checkShareLimits({ files: claims.sizes });
}

/**
 * Parses the manifest and refuses anything but this build's exact share identity.
 * @throws SiteShareRefusal INVALID_ARCHIVE for invalid JSON or an unsupported identity.
 * @complexity O(manifest bytes).
 */
export function parseShareManifest(required: { manifestBytes: Buffer; schema: { index: number; tag: string }; host: ImportInventoryHost }): SupportedShareManifest {
  return required.host.parseArchiveManifest({ bytes: required.manifestBytes, schema: required.schema });
}

/**
 * Validates every manifest record and keys it by exact path. Only the projected database and the
 * recognised portable roots/settings files may be listed; known private paths refuse.
 * @throws SiteShareRefusal (INVALID_ARCHIVE, UNSAFE_PATH, UNSAFE_FILE).
 * @complexity O(records × path length).
 */
export function buildManifestInventory(required: { files: readonly unknown[]; host: ImportInventoryHost }): Map<string, InventoryRecord> {
  const inventory = new Map<string, InventoryRecord>();
  for (const record of required.files) {
    if (typeof (record as { path?: unknown })?.path === "string" && isStaticSitePath({ path: (record as { path: string }).path })) continue;
    const file = requireArchiveFileRecord({ file: record });
    required.host.validateSharePath({ path: file.path });
    if (inventory.has(file.path) || file.path === SITE_BACKUP_MANIFEST_PATH) refuseArchive({ message: "Duplicate manifest file." });
    if (refusedInventoryPath({ path: file.path, host: required.host })) refuseArchive({ message: "Unrecognized or private file in share inventory." });
    inventory.set(file.path, file);
  }
  return inventory;
}

function refusedInventoryPath({ path, host }: { path: string; host: ImportInventoryHost }, _optional: Record<string, never> = {}): boolean {
  if (path === SITE_BACKUP_DATABASE_PATH || path === SAVED_KEYS_PATH) return false;
  const scanPath = host.archiveSecretScanPath({ path, plugins: [] });
  const privateRuntime = host.excludedSharePath({ path: scanPath });
  return privateRuntime || !host.inventoryRoots.test(path) && !host.settingsFiles.includes(path);
}

/**
 * The archive holds exactly the manifest plus one file per record (counted by alias), the database
 * is listed, and every directory entry has a listed file below it.
 * @complexity O(directories × records).
 */
export function checkArchiveMatchesInventory(required: { inventory: ReadonlyMap<string, InventoryRecord>; fileAliases: ReadonlySet<string>; directories: ReadonlySet<string> }): void {
  const { inventory } = required;
  if (inventory.size + 1 !== required.fileAliases.size || !inventory.has(SITE_BACKUP_DATABASE_PATH)) refuseArchive({ message: "ZIP inventory differs from the manifest." });
  for (const dir of required.directories) if (![...inventory.keys()].some(file => file.startsWith(dir + "/"))) refuseArchive({ message: "Unlisted ZIP directory." });
}

/**
 * Second pass: reads every listed file under its manifest size and the remaining expanded budget,
 * checks its SHA-256, and secret-scans everything except the database (the sanitizer owns that).
 * @throws SiteShareRefusal (INVALID_ARCHIVE) or the signal's reason.
 * @complexity O(payload bytes), at most 300 MiB buffered.
 */
export async function readListedFiles(required: { archive: Buffer; reader: AgentPluginArchiveReaderPort; inventory: ReadonlyMap<string, InventoryRecord>; manifestBytes: Buffer; wrapper?: string; manifest?: ArchiveManifest; modified?: Set<string>; host: ImportInventoryHost }, optional: { signal?: AbortSignal; packageFiles?: PackageFileInventory; bundledImportPluginIds?: ReadonlySet<string>; notices?: string[]; credentialWarnings?: CredentialWarning[] } = {}): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  let expanded = required.manifestBytes.length;
  for await (const entry of required.reader.entries({ archive: required.archive })) {
    if (entry.kind !== "file" || ignoredArchivePath({ path: entry.entryPath })) continue;
    const entryPath = stripArchiveWrapper({ path: entry.entryPath, wrapper: required.wrapper ?? "", host: required.host });
    if (isStaticSitePath({ path: entryPath })) continue;
    if (entryPath !== SITE_BACKUP_MANIFEST_PATH) {
      const content = await readListedFile({ entry: { ...entry, entryPath }, inventory: required.inventory, remainingBytes: required.host.limits.maxExpandedBytes - expanded, manifest: required.manifest, modified: required.modified, host: required.host }, optional);
      expanded += content.length;
      retainListedFile({ path: entryPath, content, files, plugins: required.manifest?.plugins ?? [], host: required.host }, optional);
    }
  }
  return files;
}

/** Integrity has already passed. Optional ciphertext and projected SQLite have separate owners. */
function retainListedFile(required: { path: string; content: Buffer; files: Map<string, Buffer>; plugins: ArchiveManifest["plugins"]; host: ImportInventoryHost }, optional: { packageFiles?: PackageFileInventory; bundledImportPluginIds?: ReadonlySet<string>; notices?: string[]; credentialWarnings?: CredentialWarning[] } = {}): void {
  const structured = required.path === SITE_BACKUP_DATABASE_PATH || required.path === SAVED_KEYS_PATH;
  if (!structured) required.host.requireShareSecretFree({ path: required.host.archiveSecretScanPath({ path: required.path, plugins: required.plugins }), bytes: required.content }, { ...optional, shownPath: required.path });
  required.files.set(required.path, required.content);
}

async function readListedFile(required: { entry: FileEntry; inventory: ReadonlyMap<string, InventoryRecord>; remainingBytes: number; manifest?: ArchiveManifest; modified?: Set<string>; host: ImportInventoryHost }, optional: { signal?: AbortSignal; packageFiles?: PackageFileInventory; bundledImportPluginIds?: ReadonlySet<string> }): Promise<Buffer> {
  const { entry } = required;
  const expected = required.inventory.get(entry.entryPath);
  if (!expected) refuseArchive({ message: "Unlisted ZIP file." });
  const unit = required.host.archiveCodeUnit({ path: entry.entryPath });
  if (!unit && expected.bytes !== entry.declaredSize) refuseArchive({ message: "ZIP size mismatch." });
  if (typeof entry.declaredSize !== "number" || !Number.isSafeInteger(entry.declaredSize) || entry.declaredSize < 0) refuseArchive({ message: "ZIP has an invalid declared size." });
  const content = await readBounded({ entry, maxBytes: Math.min(entry.declaredSize, required.remainingBytes), signal: optional.signal });
  verifyListedIntegrity({ content, expected, unit, modified: required.modified, message: required.host.changedArchiveMessage });
  return content;
}

/** Count decompressed bytes before retaining each chunk; metadata is never a memory budget. */
async function readBounded(required: { entry: FileEntry; maxBytes: number; signal?: AbortSignal }): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of required.entry.openReadStream({})) {
    required.signal?.throwIfAborted();
    size += chunk.length;
    if (size > required.maxBytes) refuseArchive({ message: "Expanded ZIP bytes exceed the manifest or archive cap (possible ZIP bomb)." });
    chunks.push(Buffer.from(chunk));
  }
  if (size !== required.entry.declaredSize) refuseArchive({ message: "ZIP declared and actual size differ." });
  return Buffer.concat(chunks, size);
}

function validateRawEntry(required: { entry: AgentPluginArchiveEntry; name: string; host: ImportInventoryHost }): void {
  // Validate traversal/aliases even on ignored metadata. Its known OS name and the database
  // extension are placeholders only during the pre-strip path check, never extraction paths.
  required.host.validateSharePath({ path: required.name.split("/").map(part => part === ".DS_Store" ? "finder-metadata" : part).join("/").replace(/(^|\/)content\.db$/, "$1content-database") });
  if (required.entry.kind !== "file" && required.entry.kind !== "directory") refuseArchive({ message: "ZIP links and special entries are forbidden." });
}

function claimNormalizedEntries(required: { entries: readonly AgentPluginArchiveEntry[]; claims: EntryClaims; wrapper: string; host: ImportInventoryHost }): void {
  const { entries, claims, wrapper } = required;
  for (const entry of entries) {
    if (entry.kind === "directory" && entry.entryPath.replace(/\/$/, "") === wrapper.slice(0, -1)) continue;
    const entryPath = stripArchiveWrapper({ path: entry.entryPath, wrapper, host: required.host });
    if (isStaticSitePath({ path: entryPath.replace(/\/$/, "") })) continue;
    claimEntry({ claims, entry: { ...entry, entryPath }, host: required.host });
  }
}

/** Editable code changes disable their entire unit; data integrity failures always refuse. */
function verifyListedIntegrity(required: { content: Buffer; expected: InventoryRecord; unit: string | undefined; modified: Set<string> | undefined; message: string }): void {
  if (required.content.length === required.expected.bytes && sha256Hex({ bytes: required.content }) === required.expected.sha256) return;
  if (!required.unit || !required.modified) refuseArchive({ message: required.message });
  required.modified.add(required.unit);
}
