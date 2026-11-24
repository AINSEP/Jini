import { archiveRefusalName, SiteShareRefusal } from "./share-refusal.js";
import type { TransformParams } from "@jini-ai/core/contracts/site/cms-media";

/** The caps the share policy enforces itself; a host may carry more limits and keeps them. */
export interface SharePolicyLimits {
  readonly maxFiles: number;
  readonly maxExpandedBytes: number;
  readonly maxFileBytes: number;
}

export interface SharePolicy {
  readonly limits: SharePolicyLimits;
  /** A version mismatch needs a new export from the source, never an update to the recipient. */
  readonly versionMismatchMessage: string;
  /** Reject before allocating or uploading. No required content is silently skipped. O(n). */
  checkShareLimits(required: { files: readonly { path: string; bytes: number }[]; totalBytes?: number }, _optional?: Record<string, never>): void;
}

/** The share database is bounded by the expanded-total cap, not the ordinary per-file cap. */
const DEFAULT_UNCAPPED_FILE_PATHS: readonly string[] = ["database/content.db", "content.db"];

/** Whole-number grouping for refusal copy ("2000" -> "2,000"); locale-independent. */
function groupedCount({ count }: { count: number }): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function mebibytes({ bytes }: { bytes: number }): string {
  return String(bytes / (1024 * 1024));
}

/** Bind a host's limits and version-mismatch copy to the neutral share decision logic. The numbers
 * in refusal copy are derived from the injected limits, so copy and enforcement cannot drift.
 */
export function createSharePolicy(required: { limits: SharePolicyLimits; versionMismatchMessage: string }, optional: { uncappedFilePaths?: readonly string[] } = {}): SharePolicy {
  const { limits, versionMismatchMessage } = required;
  const uncapped = new Set(optional.uncappedFilePaths ?? DEFAULT_UNCAPPED_FILE_PATHS);
  const checkShareLimits: SharePolicy["checkShareLimits"] = (args, _optional = {}) => {
    if (args.files.length > limits.maxFiles) throw new SiteShareRefusal({ code: "LIMIT_EXCEEDED", message: `Share exceeds the ${groupedCount({ count: limits.maxFiles })}-file cap. Reduce the site or wait for streaming exports.` });
    const total = args.files.reduce((sum, file) => sum + file.bytes, 0);
    if (Math.max(total, args.totalBytes ?? 0) > limits.maxExpandedBytes) throw new SiteShareRefusal({ code: "LIMIT_EXCEEDED", message: `Share exceeds the ${mebibytes({ bytes: limits.maxExpandedBytes })} MiB expanded cap. Reduce the site or wait for streaming exports.` });
    const large = args.files.find(file => !uncapped.has(file.path) && file.bytes > limits.maxFileBytes);
    if (large) throw new SiteShareRefusal({ code: "LIMIT_EXCEEDED", message: `Share file '${archiveRefusalName({ name: large.path })}' exceeds the ${mebibytes({ bytes: limits.maxFileBytes })} MiB ordinary-file cap.` });
  };
  return { limits, versionMismatchMessage, checkShareLimits };
}

/** Export/import diagnostics contain locations and classifications, never matched values. */
export interface CredentialWarning { readonly path: string; readonly kind: string }

/** Snapshot-owned metadata, never a read from mutable live media repositories. */
export interface ArchiveMediaSource {
  readonly id: string; readonly workspaceId: string; readonly slug: string;
  readonly originalFilename: string | null; readonly kind: string;
  readonly storageKey: string; readonly sha256: string;
  readonly documentOwned?: boolean;
  readonly public?: { readonly storageKey?: string; readonly sha256?: string; readonly version: number; readonly params: TransformParams };
}

export interface ShareDatabaseProjection {
  readonly credentialWarnings?: readonly CredentialWarning[];
  readonly notices?: readonly string[];
  readonly archiveMedia?: readonly ArchiveMediaSource[];
  readonly bytes: Buffer;
  readonly media: readonly { storageKey: string; sha256?: string; destinationStorageKey?: string }[];
  /** Original document policies travel separately from deduplicated blob references. */
  readonly documents?: readonly { storageKey: string; sha256: string; originalFilename: string }[];
}
export type ShareDatabaseSanitizer = (required: { snapshot: Buffer; omittedMediaIds?: readonly string[] }, optional?: { signal?: AbortSignal }) => Promise<ShareDatabaseProjection>;
