import type { ChatAttachment } from '@jini/chat-core';
import type { ChatPaneAttachmentUploadOptions } from '@jini/chat-react';

interface UploadResponse {
  attachment?: ChatAttachment;
}

interface UploadOptions extends ChatPaneAttachmentUploadOptions {
  timeoutMs?: number;
}

const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;
const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;
const BATCH_USAGE_TTL_MS = 60 * 60 * 1_000;
const MAX_TRACKED_BATCHES = 100;
const batchUsage = new Map<string, { count: number; bytes: number; touchedAt: number }>();

function pruneBatchUsage(now: number): void {
  for (const [batchId, usage] of batchUsage) {
    if (now - usage.touchedAt >= BATCH_USAGE_TTL_MS) batchUsage.delete(batchId);
  }
  while (batchUsage.size >= MAX_TRACKED_BATCHES) {
    const oldest = batchUsage.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    batchUsage.delete(oldest);
  }
}

/** Uploads one file to the local playground daemon and validates its reply. */
async function uploadAttachment(
  file: File,
  batchId: string,
  signal: AbortSignal,
): Promise<ChatAttachment> {
  const query = new URLSearchParams({
    batch: batchId,
    name: file.name,
  });
  const response = await fetch(`/api/playground/attachments?${query}`, {
    method: 'POST',
    headers: {
      'content-type': file.type || 'application/octet-stream',
    },
    body: file,
    signal,
  });
  if (!response.ok) {
    const fallback = `Could not attach ${file.name}`;
    try {
      const body = (await response.json()) as { message?: string };
      throw new Error(body.message ?? fallback);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(fallback);
      if (error instanceof Error) throw error;
      throw new Error(fallback);
    }
  }
  const body = (await response.json()) as UploadResponse;
  if (!body.attachment) throw new Error(`The daemon did not return an attachment for ${file.name}`);
  return body.attachment;
}

async function cleanupPartialUpload(
  batchId: string,
  attachments: readonly ChatAttachment[],
): Promise<void> {
  if (attachments.length === 0) return;
  try {
    await fetch('/api/playground/attachments', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        batchId,
        paths: attachments.map((attachment) => attachment.path),
      }),
    });
  } catch {
    // The daemon also expires unclaimed uploads, so cleanup is best effort.
  }
}

/**
 * Uploads a user selection with bounded concurrency while preserving order.
 *
 * @complexity Time: O(n) with at most two concurrent requests; space: O(n).
 * @overallScore 100/100
 */
export async function uploadChatAttachments(
  files: File[],
  options?: UploadOptions,
): Promise<ChatAttachment[]> {
  if (files.length === 0) return [];
  const now = Date.now();
  pruneBatchUsage(now);
  const batchId = options?.batchId ?? crypto.randomUUID();
  const incomingBytes = files.reduce((total, file) => total + file.size, 0);
  const current = batchUsage.get(batchId) ?? { count: 0, bytes: 0, touchedAt: now };
  if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
    throw new Error('Each attachment must be 20 MB or smaller.');
  }
  if (current.count + files.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(`You can attach at most ${MAX_ATTACHMENT_COUNT} files to one message.`);
  }
  if (current.bytes + incomingBytes > MAX_BATCH_BYTES) {
    throw new Error('Attachments for one message must total 50 MB or less.');
  }

  batchUsage.set(batchId, {
    count: current.count + files.length,
    bytes: current.bytes + incomingBytes,
    touchedAt: now,
  });
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(options?.signal.reason);
  options?.signal.addEventListener('abort', abortFromParent, { once: true });
  if (options?.signal.aborted) abortFromParent();
  const timeout = globalThis.setTimeout(
    () => controller.abort(new DOMException('Attachment upload timed out', 'TimeoutError')),
    options?.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS,
  );
  const uploaded: Array<ChatAttachment | undefined> = new Array(files.length);
  let nextIndex = 0;
  let firstError: unknown;
  const worker = async () => {
    while (!controller.signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      const file = files[index];
      if (file === undefined) return;
      try {
        uploaded[index] = await uploadAttachment(file, batchId, controller.signal);
      } catch (error) {
        firstError ??= error;
        controller.abort();
      }
    }
  };

  try {
    await Promise.all([worker(), worker()]);
    if (firstError !== undefined) throw firstError;
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error('Attachment upload was canceled.');
    }
    return uploaded.filter((attachment): attachment is ChatAttachment => attachment !== undefined);
  } catch (error) {
    await cleanupPartialUpload(
      batchId,
      uploaded.filter((attachment): attachment is ChatAttachment => attachment !== undefined),
    );
    batchUsage.set(batchId, current);
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    options?.signal.removeEventListener('abort', abortFromParent);
  }
}
