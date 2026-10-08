/** Compatibility entry. Inbound SSE framing is shared with CLI consumers through core's
 * dependency-free primitives; providers keep their JSON interpretation and select the exported EOF policy. */
export { decodeSseFrames, decodeSseStream, parseSseRecord } from '@jini-ai/core/primitives';
export type { DecodedSseEvent, DecodedSseFrame, SseFramingOptions } from '@jini-ai/core/primitives';
