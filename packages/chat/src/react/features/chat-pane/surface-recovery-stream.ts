import type { SurfaceEmission } from '@jini-ai/core';

/** Read bounded NDJSON frames as they arrive: waiting for response.text() would hide the very
 * card the held request is waiting on. The final frame is value-free, never the tool result.
 * @complexity O(response bytes), O(largest frame) space, capped at 5 MiB per frame.
 */
export async function readSurfaceRecoveryStream({ response, onSurface }: {
  response: Response; onSurface?: ((emission: SurfaceEmission) => void) | undefined;
}, _options = {}): Promise<{ delivered: true }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The restored card stream is unavailable.');
  const decoder = new TextDecoder();
  let buffer = '';
  let restored = false;
  const accept = (text: string) => {
    if (!text.trim()) return;
    const frame = JSON.parse(text) as { type?: unknown; emission?: SurfaceEmission; ok?: unknown };
    if (frame.type === 'surface' && frame.emission) onSurface?.(frame.emission);
    if (frame.type === 'restored') restored = frame.ok === true;
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        if (line.length > 5 * 1024 * 1024) throw new Error('The restored card is too large.');
        accept(line);
      }
      if (buffer.length > 5 * 1024 * 1024) throw new Error('The restored card is too large.');
      if (chunk.done) break;
    }
    accept(buffer);
    if (!restored) throw new Error('The card could not be restored.');
    return { delivered: true };
  } finally { await reader.cancel(); reader.releaseLock(); }
}
