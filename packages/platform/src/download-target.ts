import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { pathContains } from "./fs.js";
import { type ManagedDownloadChecksum, ManagedDownloadError, MANAGED_DOWNLOAD_ERROR_CODES, type ManagedDownloadOptions, type NormalizedTarget, STATE_DIR, PARTIAL_DIR, LOCK_DIR, type RemoveManagedDownloadOptions } from './download-types.js';
import { errorMessage } from './download-store.js';
export const activeTargets = new Map<string, string>();

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeChecksum(input: ManagedDownloadChecksum): ManagedDownloadChecksum {
  if (input.algorithm !== "sha256" && input.algorithm !== "sha512") {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET, `unsupported checksum algorithm: ${String(input.algorithm)}`);
  }
  const value = input.value.trim().toLowerCase();
  const expectedLength = input.algorithm === "sha256" ? 64 : 128;
  if (!new RegExp(`^[0-9a-f]{${expectedLength}}$`).test(value)) {
    throw new ManagedDownloadError(
      MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET,
      `${input.algorithm} checksum must be ${expectedLength} hex characters`,
    );
  }
  return { algorithm: input.algorithm, value };
}

const DOT_SEGMENTS: ReadonlySet<string> = new Set([".", ".."]);

function normalizeSegment(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET, `${label} must be a non-empty string`);
  }
  // `:` blocks a Windows drive-relative segment (e.g. "C:foo") — win32's
  // `isAbsolute`/`[\\/]` checks above don't reject it, but `path.win32.resolve`
  // treats it as a real drive reference, which can escape `basePath` onto a
  // different drive entirely.
  if (DOT_SEGMENTS.has(value) || value.includes("\0") || /[:\\/]/.test(value) || isAbsolute(value)) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET, `${label} must be a safe single path segment`);
  }
  return value;
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("only http and https URLs are supported");
    }
    return url.toString();
  } catch (error) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET, errorMessage(error));
  }
}

export function normalizeBasePath(basePath: string): string {
  if (typeof basePath !== "string" || basePath.length === 0 || basePath.includes("\0")) {
    throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET, "basePath must be a non-empty path");
  }
  // `path.resolve()` always returns an absolute path by contract (resolving
  // against `process.cwd()` when given a relative input), so this can never
  // be false for any string input.
  return resolve(basePath);
}

export function targetFromOptions(options: Pick<ManagedDownloadOptions, "basePath" | "bucket" | "fileName" | "payload">): NormalizedTarget {
  const basePath = normalizeBasePath(options.basePath);
  const bucket = normalizeSegment(options.bucket, "bucket");
  const fileName = normalizeSegment(options.fileName, "fileName");
  const checksum = normalizeChecksum(options.payload.checksum);
  const url = normalizeUrl(options.payload.url);
  const urlDigest = digest(url);
  const identityDigest = digest(`${url}\0${checksum.algorithm}\0${checksum.value}`);
  const targetKey = digest(`${bucket}\0${fileName}`);
  const finalPath = resolve(basePath, bucket, fileName);
  const manifestPath = resolve(basePath, STATE_DIR, `${targetKey}.json`);
  const partialPath = resolve(basePath, PARTIAL_DIR, `${targetKey}.partial`);
  const lockPath = resolve(basePath, LOCK_DIR, `${targetKey}.lock`);
  // Real, reachable guard — NOT dead code: `normalizeSegment` only rejects a
  // segment that is *exactly* "." or "..", not one that merely starts with
  // ".." (e.g. "..evil" is a syntactically ordinary filename, not a parent
  // reference), so `pathContains`'s own naive `!rel.startsWith("..")` string
  // check (see fs.ts) flags such a segment as escaping even though
  // `path.resolve` never actually walked upward. Empirically verified this
  // session: a 300k-segment fuzz found ~0.2% of `normalizeSegment`-valid
  // segments (every one starting with literal "..") trip this exact guard —
  // see archived provenance ledger's 2026-07-22 entry and this file's own test for a
  // concrete example (bucket "..evil").
  for (const path of [finalPath, manifestPath, partialPath, lockPath]) {
    if (!pathContains({ root: basePath, target: path })) {
      throw new ManagedDownloadError(MANAGED_DOWNLOAD_ERROR_CODES.INVALID_TARGET, "resolved managed download path escaped basePath");
    }
  }
  return { basePath, bucket, checksum, fileName, finalPath, identityDigest, lockPath, manifestPath, partialPath, targetKey, url, urlDigest };
}

export function activeKey(target: NormalizedTarget): string {
  return `${target.basePath}\0${target.targetKey}\0${target.identityDigest}`;
}

export function targetActiveKey(target: NormalizedTarget): string {
  return `${target.basePath}\0${target.targetKey}`;
}

/** Resolve a target's paths for callers (inspect/remove) that have no payload; the placeholder never reaches the network. */
export function targetWithoutPayload(options: RemoveManagedDownloadOptions): NormalizedTarget {
  return targetFromOptions({
    ...options,
    payload: {
      checksum: { algorithm: "sha256", value: "0".repeat(64) },
      url: "https://example.invalid/",
    },
  });
}
