import type { ArchivePlugin } from "./archive-manifest.js";
import { ARCHIVE_DATABASE_PATH as SITE_BACKUP_DATABASE_PATH } from "./archive-manifest.js";
import { SAVED_KEYS_PATH } from "./saved-keys-port.js";
import { addCredentialWarning, type CredentialWarning, type CredentialRedactor } from "./credential-warnings.js";
import type { PackageFileInventory } from "./share-file-policy.js";
import type { AgentPluginArchiveReaderPort } from "@jini-ai/core/contracts/site/agent-plugins-lifecycle";

/** The database projection the host sanitizer returns; the full value travels on to `applyShareProjection`. */
export interface SiteImportProjection { readonly bytes: Buffer; readonly notices?: readonly string[] | undefined; readonly credentialWarnings?: readonly CredentialWarning[] | undefined }
/** The parsed manifest fields this verifier reads; the host's manifest value is passed through whole. */
export interface SiteImportManifest { readonly files: unknown; readonly plugins: readonly ArchivePlugin[]; readonly site: { readonly name: string } }
type ScanResult = { manifestBytes: unknown; fileAliases: unknown; directories: unknown; wrapper: unknown };
type VerifyOptional = { signal?: AbortSignal | undefined; packageFiles?: PackageFileInventory | undefined; bundledImportPluginIds?: ReadonlySet<string> | undefined };

/** Host archive inventory, path mapping, limits and redaction. Every member is REQUIRED. */
export interface SiteImportVerifierHost {
  redactSecretShapes: CredentialRedactor;
  readonly maxArchiveBytes: number;
  readonly archiveTooLargeMessage: string;
  checkShareLimits(required: { files: readonly { path: string; bytes: number }[] }): void;
  refuseArchive(required: { message: string }): never;
  scanArchiveMetadata(required: { archive: Buffer; reader: AgentPluginArchiveReaderPort }, optional: VerifyOptional): Promise<ScanResult>;
  parseShareManifest(required: { manifestBytes: unknown; schema: { index: number; tag: string } }): SiteImportManifest;
  buildManifestInventory(required: { files: unknown }): unknown;
  checkArchiveMatchesInventory(required: { inventory: unknown; fileAliases: unknown; directories: unknown }): void;
  readListedFiles(required: { archive: Buffer; reader: AgentPluginArchiveReaderPort; inventory: unknown; manifestBytes: unknown; wrapper: unknown; manifest: SiteImportManifest; modified: Set<string> }, optional: VerifyOptional & { packageFiles: PackageFileInventory; credentialWarnings: CredentialWarning[] }): Promise<Map<string, Buffer>>;
  sha256Hex(required: { bytes: Buffer }): string;
  applyShareProjection(required: { files: Map<string, Buffer>; projection: SiteImportProjection; manifest: SiteImportManifest }, optional: VerifyOptional): Promise<void>;
  readBundledPackageFiles(): Promise<PackageFileInventory>;
  archiveToRuntimePath(required: { path: string; files: ReadonlyMap<string, Buffer> }): string;
  editedArchiveWarnings(required: { units: Iterable<string> }): string[];
}

export interface VerifiedSiteImport {
  encryptedKeys?: Buffer;
  name: string;
  database: Buffer;
  files: Map<string, Buffer>;
  warnings: string[];
  credentialWarnings?: readonly CredentialWarning[];
  modified: ReadonlySet<string>;
  plugins: readonly ArchivePlugin[];
  trustedPlugins: readonly ArchivePlugin[];
}

/** Read the bounded root manifest in a metadata-only first pass; never trust ZIP ordering.
 * Then verify the exact inventory and hashes, count actual expanded bytes, and ask the isolated
 * database adapter to rebuild through A's SAME sanitizer. No extraction occurs before success.
 * @throws SiteShareRefusal for malformed, unsupported, incomplete or oversized archives.
 * @complexity O(payload bytes + paths²), at most 2,000 paths/300 MiB; buffered archive.
 */
export async function verifySiteImport(required: { archive: Buffer; reader: AgentPluginArchiveReaderPort; sanitize: (required: { snapshot: Buffer }, optional: { signal?: AbortSignal | undefined }) => Promise<SiteImportProjection>; schema: { index: number; tag: string }; host: SiteImportVerifierHost }, optional: VerifyOptional = {}): Promise<VerifiedSiteImport & { credentialWarnings: readonly CredentialWarning[] }> {
  const { archive, reader, host } = required;
  if (archive.length > host.maxArchiveBytes) host.refuseArchive({ message: host.archiveTooLargeMessage });
  optional.signal?.throwIfAborted();
  const scan = await host.scanArchiveMetadata({ archive, reader }, optional);
  const manifest = host.parseShareManifest({ manifestBytes: scan.manifestBytes, schema: required.schema });
  const inventory = host.buildManifestInventory({ files: manifest.files });
  host.checkArchiveMatchesInventory({ inventory, fileAliases: scan.fileAliases, directories: scan.directories });
  // Byte identity still controls execution trust. Scan classification alone tolerates build skew.
  const packageFiles = optional.packageFiles ?? await host.readBundledPackageFiles();
  const modified = new Set<string>();
  const credentialWarnings: CredentialWarning[] = [];
  const files = await host.readListedFiles({ archive, reader, inventory, manifestBytes: scan.manifestBytes, wrapper: scan.wrapper, manifest, modified }, { ...optional, packageFiles, credentialWarnings });
  const encryptedKeys = files.get(SAVED_KEYS_PATH);
  files.delete(SAVED_KEYS_PATH);
  const plugins = manifest.plugins;
  const trustedPlugins = plugins;
  const snapshot = files.get(SITE_BACKUP_DATABASE_PATH);
  if (snapshot === undefined) return host.refuseArchive({ message: "Import archive has no content database." });
  const projection = await required.sanitize({ snapshot }, { signal: optional.signal });
  for (const warning of projection.credentialWarnings ?? []) addCredentialWarning({ ...warning, credentialWarnings, redactSecretShapes: host.redactSecretShapes });
  await host.applyShareProjection({ files, projection, manifest }, optional);
  files.delete(SITE_BACKUP_DATABASE_PATH);
  host.checkShareLimits({ files: [...files].map(([path, content]) => ({ path, bytes: content.length })).concat({ path: SITE_BACKUP_DATABASE_PATH, bytes: projection.bytes.length }) });
  const runtimeFiles = new Map([...files].map(([path, bytes]) => [host.archiveToRuntimePath({ path, files }), bytes]));
  const warnings = [...new Set([...(projection.notices ?? []), ...host.editedArchiveWarnings({ units: modified })])];
  return { name: manifest.site.name.trim(), database: projection.bytes, files: runtimeFiles, warnings, credentialWarnings, modified, plugins, trustedPlugins, ...(encryptedKeys ? { encryptedKeys } : {}) };
}

/** A manifest digest alone grants nothing: compare the entire shipped package to this build. */
function bundledIdentical(required: { plugin: ArchivePlugin; files: ReadonlyMap<string, Buffer>; packageFiles: PackageFileInventory; modified: ReadonlySet<string>; sha256Hex: SiteImportVerifierHost["sha256Hex"] }): boolean {
  const { plugin } = required;
  if (plugin.kind !== "agent" || required.modified.has("agent-plugins/" + plugin.id)) return false;
  const expected = required.packageFiles.get(plugin.digest);
  if (!expected) return false;
  const prefix = `agent-plugins/${plugin.id}/package/`;
  const actual = [...required.files].filter(([path]) => path.startsWith(prefix));
  return actual.length === expected.size && actual.every(([path, bytes]) => expected.get(path.slice(prefix.length)) === required.sha256Hex({ bytes }));
}
