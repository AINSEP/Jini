import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type ManagedDownloadProgress, type DownloadManifest, type NormalizedTarget, type DownloadAttemptResult, ManagedDownloadError, MANAGED_DOWNLOAD_ERROR_CODES } from './download-types.js';
import { statFileSize, writeJson, createManifest, errorMessage } from './download-store.js';
async function emitExistingProgress(path: string, totalBytes: number, emit: (progress: ManagedDownloadProgress) => void): Promise<void> {
  // `totalBytes` is required (not `number | undefined`): its only real call
  // site (`tryResumeDownload`) always resolves one, via a `??` chain (in
  // `acceptedResumeTotalBytes`) whose
  // last resort is arithmetic (`partialBytes + (contentLength(response) ??
  // 0)`) — never `undefined`.
  const existing = await statFileSize(path);
  if (existing == null || existing <= 0) return;
  emit({ receivedBytes: existing, sessionReceivedBytes: 0, totalBytes });
}

function contentLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length");
  if (raw == null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function validatorsFromResponse(response: Response): DownloadManifest["validators"] | undefined {
  const etag = response.headers.get("etag") ?? undefined;
  const lastModified = response.headers.get("last-modified") ?? undefined;
  return etag == null && lastModified == null ? undefined : { ...(etag == null ? {} : { etag }), ...(lastModified == null ? {} : { lastModified }) };
}

function validatorsConflict(saved: DownloadManifest["validators"] | undefined, response: Response): boolean {
  if (saved == null) return false;
  const etag = response.headers.get("etag") ?? undefined;
  const lastModified = response.headers.get("last-modified") ?? undefined;
  if (saved.etag != null && etag != null && saved.etag !== etag) return true;
  if (saved.lastModified != null && lastModified != null && saved.lastModified !== lastModified) return true;
  return false;
}

function parseContentRange(value: string | null): { end: number; start: number; totalBytes?: number } | null {
  if (value == null) return null;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  // Every group in the pattern is mandatory, so a match always carries all three.
  if (match == null) return null;
  // `\d+` always parses to an integer — except a digit run long enough to
  // overflow to Infinity, which `Number.isInteger` rejects.
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return null;
  if (match[3] === "*") return { start, end };
  const totalBytes = Number(match[3]);
  if (!Number.isInteger(totalBytes) || totalBytes <= end) return null;
  return { start, end, totalBytes };
}

async function writeResponseBodyToPartial(
  response: Response,
  target: NormalizedTarget,
  options: {
    emit: (progress: ManagedDownloadProgress) => void;
    startBytes: number;
    totalBytes?: number | undefined;
  },
): Promise<void> {
  if (response.body == null) throw new Error("download response did not include a body");
  let receivedBytes = options.startBytes;
  let sessionReceivedBytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.byteLength;
      sessionReceivedBytes += chunk.byteLength;
      options.emit({
        receivedBytes,
        sessionReceivedBytes,
        ...(options.totalBytes == null ? {} : { totalBytes: options.totalBytes }),
      });
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as never),
    meter,
    createWriteStream(target.partialPath, { flags: options.startBytes > 0 ? "a" : "w" }),
  );
}

type DownloadDeps = {
  emit: (progress: ManagedDownloadProgress) => void;
  fetchImpl: typeof globalThis.fetch;
};

type DownloadRequestOptions = {
  requestHeaders?: Record<string, string> | undefined;
};

function resumeRequestHeaders(
  input: { manifest: DownloadManifest; partialBytes: number },
  options: DownloadRequestOptions,
): Record<string, string> {
  const etag = input.manifest.validators?.etag;
  return {
    ...(options.requestHeaders ?? {}),
    ...(etag == null ? {} : { "If-Range": etag }),
    Range: `bytes=${input.partialBytes}-`,
  };
}

/** The resumed total size, or `null` when the response cannot continue the saved partial. */
function acceptedResumeTotalBytes(input: { manifest: DownloadManifest; partialBytes: number; response: Response }): number | null {
  const { manifest, partialBytes, response } = input;
  if (response.status !== 206) return null;
  const range = parseContentRange(response.headers.get("content-range"));
  if (range == null || range.start !== partialBytes || validatorsConflict(manifest.validators, response)) {
    return null;
  }
  return range.totalBytes ?? manifest.totalBytes ?? partialBytes + (contentLength(response) ?? 0);
}

async function tryResumeDownload(
  input: DownloadDeps & { manifest: DownloadManifest; target: NormalizedTarget },
  options: DownloadRequestOptions,
): Promise<DownloadAttemptResult | "restart"> {
  const { emit, fetchImpl, manifest, target } = input;
  const partialBytes = await statFileSize(target.partialPath);
  if (partialBytes == null || partialBytes <= 0) return "restart";
  const response = await fetchImpl(target.url, {
    headers: resumeRequestHeaders({ manifest, partialBytes }, options),
  });
  const totalBytes = acceptedResumeTotalBytes({ manifest, partialBytes, response });
  if (totalBytes == null) return "restart";
  await emitExistingProgress(target.partialPath, totalBytes, emit);
  await writeJson(target.manifestPath, {
    ...manifest,
    state: "partial",
    totalBytes,
    updatedAt: new Date().toISOString(),
    validators: manifest.validators ?? validatorsFromResponse(response),
  } satisfies DownloadManifest);
  await writeResponseBodyToPartial(response, target, { emit, startBytes: partialBytes, totalBytes });
  return { resumed: true, totalBytes };
}

async function downloadFromZero(
  input: DownloadDeps & { target: NormalizedTarget },
  options: DownloadRequestOptions,
): Promise<DownloadAttemptResult> {
  const { emit, fetchImpl, target } = input;
  const { requestHeaders } = options;
  await rm(target.partialPath, { force: true }).catch(() => undefined);
  const response = await fetchImpl(target.url, {
    ...(requestHeaders == null ? {} : { headers: requestHeaders }),
  });
  if (!response.ok) throw new Error(`download request returned HTTP ${response.status}`);
  const totalBytes = contentLength(response);
  const validators = validatorsFromResponse(response);
  await writeJson(target.manifestPath, createManifest({ target, state: "partial", patch: { totalBytes, validators } }));
  await writeResponseBodyToPartial(response, target, { emit, startBytes: 0, totalBytes });
  return { resumed: false, totalBytes };
}

export async function downloadWithRetries({ target, manifest, options }: { target: NormalizedTarget; manifest: DownloadManifest | null; options: {
    emit: (progress: ManagedDownloadProgress) => void;
    fetchImpl: typeof globalThis.fetch;
    maxAttempts: number;
    requestHeaders?: Record<string, string> | undefined;
  } }, _optional = {}
): Promise<DownloadAttemptResult> {
  let lastError: unknown;
  let nextManifest = manifest;
  const deps: DownloadDeps = { emit: options.emit, fetchImpl: options.fetchImpl };
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      const resume = nextManifest?.state === "partial"
        ? await tryResumeDownload({ ...deps, manifest: nextManifest, target }, options)
        : null;
      if (resume !== null && resume !== "restart") return resume;
      if (resume === "restart") {
        await rm(target.partialPath, { force: true }).catch(() => undefined);
        nextManifest = null;
      }
      return await downloadFromZero({ ...deps, target }, options);
    } catch (error) {
      lastError = error;
      nextManifest = await manifestAfterFailedAttempt({ manifest: nextManifest, target });
    }
  }
  throw new ManagedDownloadError(
    MANAGED_DOWNLOAD_ERROR_CODES.NETWORK_EXHAUSTED,
    `download failed after ${options.maxAttempts} attempts: ${errorMessage(lastError)}`,
  );
}

/** After a failed attempt, mark any bytes already on disk as a resumable partial (best-effort persisted). */
async function manifestAfterFailedAttempt(input: {
  manifest: DownloadManifest | null;
  target: NormalizedTarget;
}): Promise<DownloadManifest | null> {
  const { manifest, target } = input;
  const partialBytes = await statFileSize(target.partialPath);
  if (partialBytes == null || partialBytes <= 0) return manifest;
  const next: DownloadManifest = {
    ...(manifest ?? createManifest({ target, state: "partial" })),
    state: "partial",
    updatedAt: new Date().toISOString(),
  };
  await writeJson(target.manifestPath, next).catch(() => undefined);
  return next;
}
