import { type FileHandle, open, chmod, rm } from 'node:fs/promises';
import { AttachmentRejectedError, formatByteLimit } from './attachment-rejections.js';
import { SIGNATURE_BYTES } from './attachment-signatures.js';


/**
 * One chunk of a request body as a `Buffer`. A web request body yields `Uint8Array` chunks, which are not
 * `Buffer`s, and `String(chunk)` of one is a comma-joined number list: never take that branch for bytes.
 */
function chunkBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return Buffer.from(String(chunk));
}

/**
 * Streams a request body straight to a private file under a hard byte cap, keeping only the
 * leading signature bytes in memory so an upload never costs memory proportional to its size.
 *
 * Opened `wx`, so this can never overwrite an existing file. A partial write is removed before the
 * rejection propagates: the cap is enforced *during* the stream, which necessarily means some bytes
 * already reached disk by the time it trips.
 * An optional already-open `handle` transfers ownership here: it is closed on success or failure.
 * This lets the upload route recover a directory/open race before consuming any request bytes.
 */
export async function writeBoundedAttachmentBody(requiredArgs: { request: AsyncIterable<unknown>; filePath: string; maxBytes: number }, optionalArgs: { mode?: number; handle?: FileHandle } = {}): Promise<{ size: number; signature: Uint8Array }> {
  const {
    request,
    filePath,
    maxBytes,
    mode = 0o600,
  }: { request: AsyncIterable<unknown>; filePath: string; maxBytes: number; mode?: number } = { ...requiredArgs, ...optionalArgs };
  const handle = optionalArgs.handle ?? await open(filePath, 'wx', mode);
  let total = 0;
  let signature = Buffer.alloc(0);
  try {
    for await (const chunk of request) {
      const buffer = chunkBuffer(chunk);
      total += buffer.byteLength;
      if (total > maxBytes) {
        throw new AttachmentRejectedError({ reason: 'attachment-too-large', message: `Each attachment must be ${formatByteLimit(maxBytes)} or smaller` }
        );
      }
      if (signature.byteLength < SIGNATURE_BYTES) {
        signature = Buffer.concat(
          [signature, buffer.subarray(0, SIGNATURE_BYTES - signature.byteLength)],
          Math.min(SIGNATURE_BYTES, signature.byteLength + buffer.byteLength),
        );
      }
      await handle.write(buffer);
    }
    await handle.close();
    await chmod(filePath, mode);
    return { size: total, signature };
  } catch (error) {
    // Reached both while the handle is still open (the byte cap tripped, or the request stream
    // errored) and after it was already closed (`chmod` failed). No `.catch` is needed to tell those
    // apart: Node's `FileHandle.close()` is idempotent — closing an already-closed handle resolves
    // — so this can only reject for a handle that is genuinely still open and unclosable, which is
    // a failure worth surfacing rather than swallowing.
    await handle.close();
    await rm(filePath, { force: true });
    throw error;
  }
}
