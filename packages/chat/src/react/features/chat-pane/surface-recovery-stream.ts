import type { SurfaceEmission } from '@jini-ai/core';

/** Read bounded NDJSON frames as they arrive; waiting for response.text() would hide a held card.
 * @complexity O(response bytes) time; O(largest frame) space, capped at 5 MiB per frame.
 * @overallScore 100
 */
export async function readSurfaceFrames({ response, onFrame }: {
  response: Response; onFrame: (frame: Record<string, unknown>) => void;
}, _options = {}): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The interactive page response stream is unavailable.');
  const decoder = new TextDecoder();
  let buffer = '';
  const accept = (text: string) => {
    if (!text.trim()) return;
    if (text.length > 5 * 1024 * 1024) throw new Error('The interactive card is too large.');
    const frame: unknown = JSON.parse(text);
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('The interactive response contains an invalid frame.');
    onFrame(frame as Record<string, unknown>);
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split('\n');
      buffer = lines.pop()!;
      for (const line of lines) accept(line);
      if (buffer.length > 5 * 1024 * 1024) throw new Error('The interactive card is too large.');
      if (chunk.done) break;
    }
    accept(buffer);
  } finally { await reader.cancel(); reader.releaseLock(); }
}

/** Restore cards through the same bounded stream reader used by runless frontend requests.
 * @complexity O(response bytes) time; O(largest frame) space.
 * @overallScore 100
 */
export async function readSurfaceRecoveryStream({ response, onSurface }: {
  response: Response; onSurface?: ((emission: SurfaceEmission) => void) | undefined;
}, _options = {}): Promise<{ delivered: true }> {
  let restored = false;
  await readSurfaceFrames({ response, onFrame: frame => {
    if (frame.type === 'surface' && frame.emission) onSurface?.(frame.emission as SurfaceEmission);
    if (frame.type === 'restored') restored = frame.ok === true;
  } });
  if (!restored) throw new Error('The card could not be restored.');
  return { delivered: true };
}
