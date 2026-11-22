import { createHash } from "node:crypto";
import { ToolInputError } from "@jini-ai/core";
import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import type { SiteBackupPushProgress } from "./push-jobs.js";

/**
 * @file Uploads deferred content and appends a host-built manifest, in input order, for one commit.
 *
 * Built for large backups:
 * - a bounded number of files are read only when a worker takes them, so at most that many files
 *   are in memory, never the whole backup;
 * - small UTF-8 files go inline when the provider accepts them, saving one write request per file
 *   against the host's rate limits;
 * - identical content is uploaded once;
 * - a failure stops every worker from taking another file and names the file that failed. Transient
 *   host errors are retried inside the provider, so a failure that reaches here is final.
 */

/** Files uploaded at a time: a few overlapping requests hide per-request latency, and stay far
 *  below a host's concurrent-request limit (GitHub: 100). */
export const SITE_BACKUP_UPLOAD_CONCURRENCY = 4;

/** Inline text is held until the commit, so it is bounded; past this, files go up as blobs. */
const INLINE_TEXT_BUDGET_BYTES = 64 * 1024 * 1024;

export interface PushFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type BackupUploadEntry = {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
} & ({ readonly blobSha: string } | { readonly text: string });

/** One file to upload: its path and how to get its bytes when a worker takes it. */
export interface PendingFile {
  readonly path: string;
  load(required: Record<string, never>, optional?: Record<string, never>): Promise<{ ok: true; bytes: Uint8Array } | PushFailure>;
}

export interface UploadPlannedContentInput {
  readonly files: readonly PendingFile[];
  /** Aborted: no worker takes another file; a file already loading may still upload. */
  readonly signal: AbortSignal;
  readonly progress: SiteBackupPushProgress;
  readonly cancelled: PushFailure;
  readonly uploadBlob: (required: { path: string; content: Uint8Array }, optional?: Record<string, never>) => Promise<{ ok: true; blobSha: string } | PushFailure>;
  readonly buildManifest: (required: { entries: BackupUploadEntry[] }, optional?: Record<string, never>) => { path: string; content: Uint8Array };
}

/** The bytes, as text, when they are valid UTF-8 without a NUL — else `null`. The BOM is kept. */
function asUtf8Text(content: Uint8Array): string | null {
  if (content.includes(0)) return null;
  return orFallbackSync<string | null>({
    work: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content),
    fallback: null,
    step: "decode backup inline UTF-8",
  });
}

/** Turns file content into tree entries: inline text when the provider takes it, else an uploaded
 *  blob — once per distinct content, even when two workers meet the same bytes at once. */
class EntryBuilder {
  private readonly uploads = new Map<string, Promise<{ ok: true; blobSha: string } | PushFailure>>();
  private inlineBytes = 0;
  private readonly input: UploadPlannedContentInput;
  private readonly inlineTextMaxBytes: number | undefined;
  constructor(input: UploadPlannedContentInput, { inlineTextMaxBytes }: { inlineTextMaxBytes?: number | undefined } = {}) {
    this.input = input;
    this.inlineTextMaxBytes = inlineTextMaxBytes;
  }

  /** @complexity O(bytes) to hash and decode; at most one upload per distinct content. */
  async entryFor({ path, content }: { path: string; content: Uint8Array }, _optional: Record<string, never> = {}): Promise<BackupUploadEntry | PushFailure> {
    const sha256 = createHash("sha256").update(content).digest("hex");
    const text = this.inlineText(content);
    if (text !== null) return { path, text, bytes: content.byteLength, sha256 };
    let pending = this.uploads.get(sha256);
    if (pending === undefined) {
      pending = this.input.uploadBlob({ path, content });
      this.uploads.set(sha256, pending);
    }
    const uploaded = await pending;
    if (!uploaded.ok) return { ok: false, code: uploaded.code, message: `uploading '${path}' failed: ${uploaded.message}` };
    return { path, blobSha: uploaded.blobSha, bytes: content.byteLength, sha256 };
  }

  private inlineText(content: Uint8Array): string | null {
    const max = this.inlineTextMaxBytes;
    if (max === undefined || content.byteLength > max || this.inlineBytes + content.byteLength > INLINE_TEXT_BUDGET_BYTES) return null;
    const text = asUtf8Text(content);
    if (text !== null) this.inlineBytes += content.byteLength;
    return text;
  }
}

/**
 * Runs `work` over `count` indexes with at most `concurrency` in flight; the first failure (or an
 * abort) stops every worker from taking another index.
 *
 * @complexity O(count) calls of `work`.
 */
async function runBounded({ count, concurrency, signal, cancelled, work }: { count: number; concurrency: number; signal: AbortSignal; cancelled: PushFailure; work: (index: number) => Promise<PushFailure | null> }, _optional: Record<string, never> = {}): Promise<PushFailure | null> {
  let next = 0;
  let failure: PushFailure | null = null;
  const worker = async (): Promise<void> => {
    while (failure === null && !signal.aborted && next < count) {
      const index = next;
      next++;
      const outcome = await work(index);
      if (outcome !== null && failure === null) failure = outcome;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, count)) }, worker));
  return failure ?? (signal.aborted ? cancelled : null);
}

/**
 * Uploads the content and returns the folder's entries, the manifest last.
 *
 * @complexity O(total bytes); one upload per distinct non-inline content.
 */
export async function uploadPlannedContent(
  input: UploadPlannedContentInput,
  { concurrency = SITE_BACKUP_UPLOAD_CONCURRENCY, inlineTextMaxBytes }: { concurrency?: number; inlineTextMaxBytes?: number } = {},
): Promise<{ ok: true; entries: BackupUploadEntry[] } | PushFailure> {
  const { files, progress } = input;
  const builder = new EntryBuilder(input, { inlineTextMaxBytes });
  const entries: BackupUploadEntry[] = [];
  entries.length = files.length;
  const failure = await runBounded({ count: files.length, concurrency, signal: input.signal, cancelled: input.cancelled, work: async (index) => {
    const file = files[index];
    if (file === undefined) throw new ToolInputError({ message: `Backup upload has no file at index ${index}` });
    const loaded = await file.load({});
    if (!loaded.ok) return loaded;
    const entry = await builder.entryFor({ path: file.path, content: loaded.bytes });
    if ("ok" in entry) return entry;
    entries[index] = entry;
    progress.filesDone += 1;
    progress.bytesDone += entry.bytes;
    return null;
  } });
  if (failure !== null) return failure;
  const manifest = input.buildManifest({ entries });
  const manifestEntry = await builder.entryFor(manifest);
  if ("ok" in manifestEntry) return manifestEntry;
  return { ok: true, entries: [...entries, manifestEntry] };
}
