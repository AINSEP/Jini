import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { type StoreSentinel, STORE_KIND, STORE_SCHEMA_VERSION, STORE_SENTINEL, type NormalizedTarget, ManagedDownloadError, MANAGED_DOWNLOAD_ERROR_CODES, STATE_DIR, PARTIAL_DIR, LOCK_DIR, type ManagedDownloadChecksum, type DownloadManifest, MANIFEST_KIND, MANIFEST_SCHEMA_VERSION } from './download-types.js';
export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error == null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return code == null ? null : String(code);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

async function directoryIsEmpty(path: string): Promise<boolean> {
  const entries = await readdir(path);
  return entries.length === 0;
}

// Every caller feeds this a `JSON.parse` result, and a parsed JSON array can
// never carry the named string keys (`kind`, `algorithm`, `pid`, ...) each
// guard goes on to require, so arrays are rejected without a separate
// `Array.isArray` check.
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

function isStoreSentinel(value: unknown): value is StoreSentinel {
  if (!isPlainObject(value)) return false;
  const record = value as Partial<StoreSentinel>;
  return record.kind === STORE_KIND && record.schemaVersion === STORE_SCHEMA_VERSION && typeof record.createdAt === "string";
}

async function writeSentinel(basePath: string): Promise<void> {
  await writeJson(join(basePath, STORE_SENTINEL), {
    createdAt: new Date().toISOString(),
    kind: STORE_KIND,
    schemaVersion: STORE_SCHEMA_VERSION,
  } satisfies StoreSentinel);
}

/** Clear only this target's data after rechecking store ownership; keep its lock held. */
export async function resetOwnedTarget({ target }: { target: NormalizedTarget }, _options = {}): Promise<void> {
  const { basePath } = target;
  const sentinel = await readJson<unknown>(join(basePath, STORE_SENTINEL));
  if (!isStoreSentinel(sentinel)) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.STORE_NOT_OWNED, `download base is not owned: ${basePath}`);
  }
  for (const path of [target.finalPath, target.partialPath, target.manifestPath]) {
    await rm(path, { force: true }).catch(() => undefined);
  }
}

async function ensureStoreDirs(basePath: string): Promise<void> {
  await mkdir(join(basePath, STATE_DIR), { recursive: true });
  await mkdir(join(basePath, PARTIAL_DIR), { recursive: true });
  await mkdir(join(basePath, LOCK_DIR), { recursive: true });
}

export async function ensureManagedBase(basePath: string): Promise<void> {
  await mkdir(basePath, { recursive: true });
  const entry = await lstat(basePath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.STORE_NOT_OWNED, `download base is not an owned directory: ${basePath}`);
  }
  const sentinelPath = join(basePath, STORE_SENTINEL);
  const sentinel = await readJson<unknown>(sentinelPath);
  if (sentinel != null && !isStoreSentinel(sentinel)) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.STORE_NOT_OWNED, `download base has an invalid ownership marker: ${basePath}`);
  }
  if (sentinel == null) {
    if (!(await directoryIsEmpty(basePath))) {
      throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.STORE_NOT_OWNED, `download base is not empty and has no ownership marker: ${basePath}`);
    }
    await writeSentinel(basePath);
  }
  await ensureStoreDirs(basePath);
}

function isChecksum(value: unknown): value is ManagedDownloadChecksum {
  if (!isPlainObject(value)) return false;
  const checksum = value as Partial<ManagedDownloadChecksum>;
  return (
    (checksum.algorithm === "sha256" || checksum.algorithm === "sha512") &&
    typeof checksum.value === "string"
  );
}

const MANIFEST_STRING_FIELDS = [
  "bucket",
  "fileName",
  "targetKey",
  "identityDigest",
  "urlDigest",
  "createdAt",
  "updatedAt",
] as const satisfies ReadonlyArray<keyof DownloadManifest>;

function isManifest(value: unknown): value is DownloadManifest {
  if (!isPlainObject(value)) return false;
  const record = value as Partial<DownloadManifest>;
  const versionMatches = record.kind === MANIFEST_KIND && record.schemaVersion === MANIFEST_SCHEMA_VERSION;
  const knownState = record.state === "complete" || record.state === "partial";
  return (
    versionMatches &&
    MANIFEST_STRING_FIELDS.every((field) => typeof record[field] === "string") &&
    isChecksum(record.checksum) &&
    knownState
  );
}

export async function readManifest(path: string): Promise<DownloadManifest | "invalid" | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return isManifest(parsed) ? parsed : "invalid";
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    return "invalid";
  }
}

const MANIFEST_IDENTITY_FIELDS = ["bucket", "fileName", "targetKey", "identityDigest", "urlDigest"] as const satisfies ReadonlyArray<
  keyof DownloadManifest & keyof NormalizedTarget
>;

export function manifestMatchesTarget(manifest: DownloadManifest, target: NormalizedTarget): boolean {
  const identityMatches = MANIFEST_IDENTITY_FIELDS.every((field) => manifest[field] === target[field]);
  const checksumMatches =
    manifest.checksum.algorithm === target.checksum.algorithm &&
    manifest.checksum.value.toLowerCase() === target.checksum.value;
  return identityMatches && checksumMatches;
}

export function createManifest({ target, state, patch = {} }: { target: NormalizedTarget; state: "complete" | "partial"; patch?: Partial<Pick<DownloadManifest, "totalBytes" | "validators">> | undefined }, _optional = {}
): DownloadManifest {
  const now = new Date().toISOString();
  return {
    bucket: target.bucket,
    checksum: target.checksum,
    createdAt: now,
    fileName: target.fileName,
    identityDigest: target.identityDigest,
    kind: MANIFEST_KIND,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    state,
    targetKey: target.targetKey,
    updatedAt: now,
    urlDigest: target.urlDigest,
    ...patch,
  };
}

export async function hashFile(path: string, algorithm: "sha256" | "sha512"): Promise<string> {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

export async function statFileSize(path: string): Promise<number | null> {
  try {
    const entry = await stat(path);
    return entry.isFile() ? entry.size : null;
  } catch {
    return null;
  }
}
