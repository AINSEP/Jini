
export const STORE_SENTINEL = ".jini-download-root.json";
export const STATE_DIR = ".state";
export const PARTIAL_DIR = ".partial";
export const LOCK_DIR = ".locks";
export const STORE_SCHEMA_VERSION = 1;
export const MANIFEST_SCHEMA_VERSION = 1;
export const STORE_KIND = "jini-managed-download-root";
export const MANIFEST_KIND = "jini-managed-download";

export type ManagedDownloadChecksum = {
  algorithm: "sha256" | "sha512";
  value: string;
};

export type ManagedDownloadPayload = {
  checksum: ManagedDownloadChecksum;
  headers?: Record<string, string>;
  url: string;
};

export type ManagedDownloadProgress = {
  receivedBytes: number;
  sessionReceivedBytes: number;
  totalBytes?: number;
};

export type ManagedDownloadOptions = {
  basePath: string;
  bucket: string;
  fileName: string;
  fetch?: typeof globalThis.fetch;
  maxAttempts?: number;
  onProgress?: (progress: ManagedDownloadProgress) => void;
  payload: ManagedDownloadPayload;
  signal?: AbortSignal;
};

export type ManagedDownloadResult = {
  bucket: string;
  bytes: number;
  checksum: ManagedDownloadChecksum;
  fileName: string;
  path: string;
  reusedComplete: boolean;
  resumed: boolean;
  urlDigest: string;
};

export type DownloadCopyAndClearOptions = ManagedDownloadOptions & {
  outputPath: string;
};

export type DownloadCopyAndClearResult = {
  bytes: number;
  cleanup: "deferred" | "removed";
  cleanupWarning?: string;
  outputPath: string;
  reusedComplete: boolean;
  resumed: boolean;
};

export type ManagedDownloadInspection = {
  bucket: string;
  complete: boolean;
  fileName: string;
  manifest: "complete" | "missing" | "partial" | "unreadable";
  path: string;
};

export type RemoveManagedDownloadOptions = {
  basePath: string;
  bucket: string;
  fileName: string;
};

export type RemoveManagedDownloadResult = {
  removed: boolean;
};

export type PruneManagedDownloadsOptions = {
  basePath: string;
  now?: Date;
  olderThanMs?: number;
};

export type PruneManagedDownloadsResult = {
  removed: number;
  warnings: string[];
};

export const MANAGED_DOWNLOAD_ERROR_CODES = Object.freeze({
  ABORTED: "aborted",
  CHECKSUM_MISMATCH: "checksum-mismatch",
  INVALID_TARGET: "invalid-target",
  NETWORK_EXHAUSTED: "network-exhausted",
  OUTPUT_CONFLICT: "output-conflict",
  STORE_CORRUPT: "store-corrupt",
  STORE_NOT_OWNED: "store-not-owned",
  TARGET_CONFLICT: "target-conflict",
  TARGET_LOCKED: "target-locked",
} as const);

export type ManagedDownloadErrorCode =
  (typeof MANAGED_DOWNLOAD_ERROR_CODES)[keyof typeof MANAGED_DOWNLOAD_ERROR_CODES];

export class ManagedDownloadError extends Error {
  readonly code: ManagedDownloadErrorCode;
  readonly details?: unknown;

  constructor(code: ManagedDownloadErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ManagedDownloadError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export type StoreSentinel = {
  createdAt: string;
  kind: typeof STORE_KIND;
  schemaVersion: typeof STORE_SCHEMA_VERSION;
};

export type DownloadManifest = {
  bucket: string;
  checksum: ManagedDownloadChecksum;
  createdAt: string;
  fileName: string;
  identityDigest: string;
  kind: typeof MANIFEST_KIND;
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  state: "complete" | "partial";
  targetKey: string;
  totalBytes?: number | undefined;
  updatedAt: string;
  urlDigest: string;
  validators?: {
    etag?: string | undefined;
    lastModified?: string | undefined;
  } | undefined;
};

export type NormalizedTarget = {
  basePath: string;
  bucket: string;
  checksum: ManagedDownloadChecksum;
  fileName: string;
  finalPath: string;
  identityDigest: string;
  lockPath: string;
  manifestPath: string;
  partialPath: string;
  targetKey: string;
  url: string;
  urlDigest: string;
};

export type ActiveTask = {
  listeners: Set<(progress: ManagedDownloadProgress) => void>;
  promise: Promise<ManagedDownloadResult>;
  targetKey: string;
};

export type CopyLease = {
  key: string;
};

export type CopyLeaseState = {
  clearRequested: boolean;
  count: number;
  removeOptions: RemoveManagedDownloadOptions | null;
};

export type AcquiredLock = {
  path: string;
};

export type DownloadLockFile = {
  createdAt: string;
  pid: number;
  processStartedAt?: string;
};

export type DownloadAttemptResult = {
  resumed: boolean;
  totalBytes?: number | undefined;
};

export type ReusableState = {
  manifest: DownloadManifest | null;
  reset?: boolean;
  result?: ManagedDownloadResult;
};
