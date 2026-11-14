/** Compatibility entry. Inbound SSE framing is shared with CLI consumers through core's
 * dependency-free primitives; providers keep their JSON interpretation and select the exported EOF policy. */
export { decodeSseFrames, decodeSseStream, parseSseRecord } from '@jini-ai/core/primitives';
export type { DecodedSseEvent, DecodedSseFrame, SseFramingOptions } from '@jini-ai/core/primitives';

/** Parses an SSE frame as a JSON object; malformed and non-object payloads are ignored. */
export function parseSseJsonRecord({ raw }: { raw: string }, _optional: Record<string, never> = {}): Record<string, unknown> | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : null;
}
