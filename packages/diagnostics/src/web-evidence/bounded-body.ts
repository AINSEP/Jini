/**
 * Reads at most `maxBytes` from a fetch response body, stopping the stream once the cap is hit.
 *
 * Stops rather than buffering-then-slicing so an unexpectedly large route cannot be used to
 * exhaust memory. Decoding is UTF-8 and non-strict, so a multi-byte character split by the cap
 * degrades to a replacement character instead of throwing.
 *
 * @param required.response - The fetch response.
 * @param required.maxBytes - Cap, already clamped by the caller.
 * @returns The decoded text, how many bytes were read, and whether the cap stopped the read.
 * @complexity O(min(B, maxBytes)) in the response size.
 * @example await readBoundedBody({ response: res, maxBytes: 200_000 });
 */
export async function readBoundedBody(
  { response, maxBytes }: { response: Response; maxBytes: number },
  _optional = {},
): Promise<{ body: string; bodyBytes: number; truncated: boolean }> {
  if (!response.body) return { body: "", bodyBytes: 0, truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    let done = false;
    while (!done && !truncated) {
      const next = await reader.read();
      done = next.done === true;
      const value = next.value;
      if (!done && value) {
        const remaining = maxBytes - total;
        truncated = value.byteLength > remaining;
        const size = truncated ? remaining : value.byteLength;
        chunks.push(value.subarray(0, size));
        total += size;
      }
    }
  } finally {
    await reader.cancel().catch(() => {
      // The response is already being abandoned; a cancel failure adds nothing the caller can act on.
    });
  }

  return { body: new TextDecoder("utf-8").decode(joinChunks({ chunks, total })), bodyBytes: total, truncated };
}

/**
 * Joins already-capped chunks into one byte array. Written against `Uint8Array` alone (not a Node-only
 * byte-buffer type) because this entry is universal and must not reach a Node global.
 *
 * @param required.chunks - The kept slices, in stream order.
 * @param required.total - The sum of their byte lengths, used to size the result once.
 * @complexity O(total) bytes copied once.
 */
function joinChunks({ chunks, total }: { chunks: Uint8Array[]; total: number }, _optional = {}): Uint8Array {
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
