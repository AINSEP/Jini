import { SiteShareRefusal, archiveRefusalName } from "./share-refusal.js";
import { SHARED_PLUGIN_MEMORY } from "./share-file-policy.js";
import { isStaticSitePath, type StaticSiteMetadata } from "./static-copy.js";
import { SAVED_KEYS_PATH, ENCRYPTED_KEYS_DESCRIPTOR } from "./saved-keys-port.js";

/** The runtime schema identity an archive records and a restore compares against. */
export interface ArchiveSchemaIdentity { readonly index: number; readonly tag: string }

/** What the host owns: the file-count and manifest-size caps, its path-claim rules, the schema journal and the mismatch advice. */
export interface ArchiveManifestDeps {
  readonly limits: { readonly maxManifestBytes: number; readonly maxFiles: number };
  /** Host advice shown when the archive came from a known but different build. */
  readonly versionMismatchMessage: string;
  /** Claims one archive path (throws a {@link SiteShareRefusal}) so aliases and duplicates cannot share a file. */
  readonly claimSharePath: (required: { path: string; directory: boolean; aliases: Map<string, string>; files: Set<string> }) => void;
  /** Reads only the trusted migration journal: is this identity one this build ships. */
  readonly isBundledSchemaIdentity: (required: { schema: ArchiveSchemaIdentity }) => boolean;
}

export const ARCHIVE_MANIFEST_PATH = "manifest.json";
export const ARCHIVE_DATABASE_PATH = "content.db";
export interface ArchiveFile { readonly path: string; readonly bytes: number; readonly sha256: string }
export interface ArchiveMedia { readonly id: string; readonly slug: string; readonly path: string; readonly sha256: string }
export interface ArchivePlugin {
  readonly kind: "agent" | "site";
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly enabled: boolean;
  readonly shipped: boolean;
}
export interface ArchiveManifest<TScopes extends object = Record<string, boolean>> {
  readonly formatVersion: 2;
  readonly profile: "share";
  readonly schema: ArchiveSchemaIdentity;
  readonly site: { readonly name: string };
  readonly scopes: TScopes;
  readonly media: readonly ArchiveMedia[];
  readonly plugins: readonly ArchivePlugin[];
  readonly files: readonly ArchiveFile[];
  readonly encryptedKeys?: typeof ENCRYPTED_KEYS_DESCRIPTOR;
  readonly staticSite?: StaticSiteMetadata;
  readonly staticSiteOmitted?: string;
}
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const ROOT = new RegExp(String.raw`^(?:media\/[^/]+|themes\/.+|plugins\/[^/]+\/(?:package|${SHARED_PLUGIN_MEMORY})\/.+|agent-plugins\/[^/]+\/(?:package|${SHARED_PLUGIN_MEMORY})\/.+|skills\/.+)$`);

function invalid(): never { throw new SiteShareRefusal({ code: "INVALID_ARCHIVE", message: "Invalid v2 share manifest, inventory or schema identity." }); }

/** The codec's operations, bound to a host by {@link createArchiveManifestCodec}. */
export interface ArchiveManifestCodec<TScopes extends object> {
  /** Serializes the sole importable ZIP contract; repository backup retains its own manifest. */
  buildArchiveManifest(required: Omit<ArchiveManifest<TScopes>, "formatVersion" | "profile">, _optional?: object): string;
  /** Parses untrusted JSON and validates identity, paths, hashes and cross-record uniqueness.
   * @throws SiteShareRefusal for v1, malformed records or a different runtime schema.
   * @complexity O(files² + media + plugins), bounded by the shared 2,000-entry cap.
   */
  parseArchiveManifest(required: { bytes: Buffer; schema: ArchiveSchemaIdentity }, _optional?: object): ArchiveManifest<TScopes>;
}

/** Binds the share manifest contract to a host's caps, path rules and schema journal. */
export function createArchiveManifestCodec<TScopes extends object = Record<string, boolean>>(deps: ArchiveManifestDeps): ArchiveManifestCodec<TScopes> {
  return {
    buildArchiveManifest(required, _optional = {}) {
      const manifest: ArchiveManifest<TScopes> = { formatVersion: 2, profile: "share", ...required };
      validateManifest({ manifest, schema: required.schema, deps });
      return JSON.stringify(manifest, null, 2) + "\n";
    },
    parseArchiveManifest(required, _optional = {}) {
      if (required.bytes.length > deps.limits.maxManifestBytes) invalid();
      let manifest: unknown;
      try { manifest = JSON.parse(required.bytes.toString("utf8")); } catch { invalid(); }
      validateManifest({ manifest, schema: required.schema, deps });
      return manifest as ArchiveManifest<TScopes>;
    },
  };
}

// The manifest is untrusted JSON of any shape; each predicate reads it exactly as the archive gave it.
function validateManifest({ manifest: m, schema, deps }: { manifest: any; schema: ArchiveSchemaIdentity; deps: ArchiveManifestDeps }): void {
  validateIdentity({ manifest: m });
  validateSiteName({ name: m.site?.name });
  if (!["database", "media", "themes", "plugins", "settings"].every(scope => m.scopes?.[scope] === true)) invalid();
  if (!Array.isArray(m.files) || m.files.length + 1 > deps.limits.maxFiles) invalid();
  const files = validateFiles({ files: m.files, deps });
  if (!Array.isArray(m.media) || !Array.isArray(m.plugins)) invalid();
  validateMedia({ media: m.media, files });
  validatePlugins({ plugins: m.plugins, files });
  validateEncryptedKeys({ descriptor: m.encryptedKeys, files });
  validateSchemaVersion({ identity: m.schema, schema, deps });
}

function validateFiles({ files, deps }: { files: any[]; deps: ArchiveManifestDeps }): Map<string, ArchiveFile> {
  const aliases = new Map<string, string>(), names = new Set<string>();
  const inventory = new Map<string, ArchiveFile>();
  deps.claimSharePath({ path: ARCHIVE_MANIFEST_PATH, directory: false, aliases, files: names });
  for (const record of files) {
    // Static copies are a convenience for humans, never restore input or an integrity dependency.
    if (typeof record?.path === "string" && isStaticSitePath({ path: record.path })) continue;
    const file = requireArchiveFileRecord({ file: record });
    if (![ARCHIVE_DATABASE_PATH, "settings.json", SAVED_KEYS_PATH].includes(file.path) && !ROOT.test(file.path)) invalid();
    deps.claimSharePath({ path: file.path, directory: false, aliases, files: names });
    inventory.set(file.path, file);
  }
  if (!inventory.has(ARCHIVE_DATABASE_PATH) || !inventory.has("settings.json")) invalid();
  return inventory;
}

/** Only the exact versioned optional encrypted entry is recognized; no generic secrets root. */
function validateEncryptedKeys(required: { descriptor: any; files: ReadonlyMap<string, ArchiveFile> }, _options = {}): void {
  if (required.descriptor === undefined) { if (required.files.has(SAVED_KEYS_PATH)) invalid(); return; }
  const value = required.descriptor;
  if (value?.version !== 1 || value.path !== SAVED_KEYS_PATH || value.format !== ENCRYPTED_KEYS_DESCRIPTOR.format) invalid();
  if (!required.files.has(SAVED_KEYS_PATH)) invalid();
}

function validateMedia({ media, files }: { media: any[]; files: Map<string, ArchiveFile> }): void {
  const ids = new Set<string>(), paths = new Set<string>();
  for (const row of media) {
    if (!validMediaIdentity({ row, ids })) invalid();
    if (!validMediaPath({ row, paths })) invalid();
    if (files.get(row.path)?.sha256 !== row.sha256) invalid();
    ids.add(row.id); paths.add(row.path);
  }
  if ([...files.keys()].filter(path => path.startsWith("media/")).length !== paths.size) invalid();
}

function validatePlugins({ plugins, files }: { plugins: any[]; files: Map<string, ArchiveFile> }): void {
  const ids = new Set<string>();
  for (const row of plugins) {
    if (!validPluginIdentity({ row })) invalid();
    const key = row.kind + "/" + row.id;
    if (ids.has(key)) invalid();
    validatePluginPackage({ row, files });
    ids.add(key);
  }
  requirePluginCoverage({ files, ids });
}

function validatePluginPackage({ row, files }: { row: any; files: Map<string, ArchiveFile> }, _options = {}): void {
  if (!validPluginVersion({ row })) invalid();
  if (typeof row.enabled !== "boolean" || row.shipped !== true) invalid();
  const root = (row.kind === "agent" ? "agent-plugins/" : "plugins/") + row.id + "/package/";
  if (![...files.keys()].some(path => path.startsWith(root))) invalid();
}

function validateSiteName(required: { name: unknown }): void {
  if (typeof required.name !== "string" || !required.name.trim() || required.name.length > 200) invalid();
}
function validMediaIdentity({ row, ids }: { row: any; ids: ReadonlySet<string> }): boolean {
  return typeof row?.id === "string" && Boolean(row.id) && !ids.has(row.id) && typeof row.slug === "string";
}
function validMediaPath({ row, paths }: { row: any; paths: ReadonlySet<string> }): boolean {
  return typeof row.path === "string" && /^media\/[^/]+$/.test(row.path) && !paths.has(row.path) && HASH.test(row.sha256);
}
function validPluginIdentity({ row }: { row: any }): boolean {
  return ["agent", "site"].includes(row?.kind) && typeof row.id === "string" && row.id.length <= 64 && ID.test(row.id);
}
function validPluginVersion({ row }: { row: any }): boolean {
  return typeof row.version === "string" && Boolean(row.version) && HASH.test(row.digest);
}

function requirePluginCoverage(required: { files: ReadonlyMap<string, ArchiveFile>; ids: ReadonlySet<string> }): void {
  for (const file of required.files.keys()) {
    const match = /^(agent-plugins|plugins)\/([^/]+)\/package\//.exec(file);
    if (match && !required.ids.has((match[1] === "agent-plugins" ? "agent" : "site") + "/" + match[2])) invalid();
  }
}

/** Refuse malformed identities separately so version advice never masks a broken manifest shape. */
function validateIdentity({ manifest: m }: { manifest: any }, _options = {}): void {
  if (m?.formatVersion !== 2 || m.profile !== "share") invalid();
  // Library added columns, not a new manifest identity. Historical database compatibility
  // belongs to the worker's trusted schema matcher, never invented migration-ID aliases.
  if (!Number.isSafeInteger(m.schema?.index) || typeof m.schema?.tag !== "string") invalid();
}

/** After structural validation, distinguish an invented identity from a known source version.
 * Reads only the trusted journal through its owner; throws INVALID_ARCHIVE without touching SQLite.
 * O(bundled migrations), with no source DDL or migration code executed.
 */
function validateSchemaVersion({ identity, schema, deps }: { identity: ArchiveSchemaIdentity; schema: ArchiveSchemaIdentity; deps: ArchiveManifestDeps }, _options = {}): void {
  if (identity.index === schema.index && identity.tag === schema.tag) return;
  if (!deps.isBundledSchemaIdentity({ schema: identity })) throw new SiteShareRefusal({ code: "INVALID_ARCHIVE", message: `Unknown archive schema identity ${JSON.stringify({ index: identity.index, tag: archiveRefusalName({ name: identity.tag }) })}.` });
  throw new SiteShareRefusal({ code: "INVALID_ARCHIVE", message: deps.versionMismatchMessage });
}

/** The single file-record contract shared by manifest parsing and inventory construction.
 * @returns A path/size/hash record, or throws SiteShareRefusal for malformed input.
 */
export function requireArchiveFileRecord(required: { file: unknown }, _optional = {}): ArchiveFile {
  const file = required.file;
  if (typeof file !== "object" || file === null || !("path" in file) || typeof file.path !== "string") invalid();
  requireArchiveFileMetadata(file);
  return file as ArchiveFile;
}

function requireArchiveFileMetadata(file: object): void {
  if (!("bytes" in file) || typeof file.bytes !== "number" || !Number.isSafeInteger(file.bytes) || file.bytes < 0
    || !("sha256" in file) || typeof file.sha256 !== "string" || !HASH.test(file.sha256)) invalid();
}
