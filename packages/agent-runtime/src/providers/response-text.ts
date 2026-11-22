/** Maximum bytes retained from an upstream provider's error response. */
export const MAX_PROVIDER_ERROR_BYTES = 64 * 1024;

/** Collects a bounded response, refusing excess bytes and closing the iterator on every exit.
 * Errors contain no upstream content. O(bytes) time/space, bounded by maxBytes. */
export async function readProviderResponseText(
  { body }: { body: AsyncIterable<Uint8Array | string> },
  { maxBytes = MAX_PROVIDER_ERROR_BYTES }: { maxBytes?: number } = {},
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid provider response limit');
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of body) {
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (size > maxBytes) throw new Error('Provider response exceeded the byte limit');
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk));
    }
  } catch {
    throw new Error('Provider response could not be read within the byte limit');
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

/** Extracts an upstream error message or a trimmed, bounded raw response. */
export function extractProviderErrorDetail({ rawText }: { rawText: string }, _optional: Record<string, never> = {}): string {
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const error: unknown = (parsed as Record<string, unknown>).error;
      if (typeof error === 'object' && error !== null && !Array.isArray(error) && typeof (error as Record<string, unknown>).message === 'string') {
        return (error as { message: string }).message;
      }
    }
  } catch {
    // Non-JSON error body — fall through to the raw text below.
  }
  return rawText.trim().slice(0, 500);
}
