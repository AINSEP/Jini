/** Audit writers must store exact chunks in blobs and retain resolvable references separately.
 * This port deliberately cannot masquerade as the inline RunByteJournal contract. */
export interface StdoutJournalBlobPort {
  /** Buffer chunks remain bytes, including UTF-8 characters split at OS read boundaries. */
  record(input: { runId: string; chunk: string | Uint8Array }, options?: Record<string, never>): Promise<void>;
}

function imageSummary(value: Record<string, unknown>): Record<string, unknown> | undefined {
  if (value.type !== 'image') return undefined;
  if (typeof value.mimeType === 'string' && typeof value.data === 'string') {
    return { ...value, data: `[image ${value.mimeType}; ${value.data.length} base64 characters]` };
  }
  const source = value.source;
  if (typeof source !== 'object' || source === null) return undefined;
  const image = source as Record<string, unknown>;
  if (image.type !== 'base64' || typeof image.data !== 'string' || typeof image.media_type !== 'string') return undefined;
  return { ...value, source: { ...image, data: `[image ${image.media_type}; ${image.data.length} base64 characters]` } };
}

/** Redacts only recognized image fields, including JSON-encoded tool-result content.
 * @complexity O(n) frame bytes, bounded by the framing limit before parsing. */
function summarizeImages(_key: string, value: unknown): unknown {
  if (_key === 'content' && typeof value === 'string') return projectDiagnosticFrame({ line: value });
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  return imageSummary(value as Record<string, unknown>) ?? value;
}

/** Projects one complete diagnostic frame; ordinary non-JSON output remains byte-identical. */
export function projectDiagnosticFrame({ line }: { line: string }, { maxFrameChars = 16 * 1024 * 1024 }: { maxFrameChars?: number } = {}): string {
  if (line.length > maxFrameChars) return '[diagnostic frame exceeded image projection limit]';
  try { return JSON.stringify(JSON.parse(line), summarizeImages); } catch { return line; }
}

/** Bounded JSONL framing: split chunks are held until complete, tails flush at close.
 * Oversized frames produce an explicit notice and are discarded through their newline.
 * @complexity O(n) total input characters; O(maxFrameChars) retained carry, no per-chunk joins. */
export function createToolResultDiagnosticProjection(_input: Record<string, never>, { maxFrameChars = 16 * 1024 * 1024 }: { maxFrameChars?: number } = {}) {
  if (!Number.isSafeInteger(maxFrameChars) || maxFrameChars < 1) throw new Error('diagnostic frame limit must be a positive integer');
  let parts: string[] = [];
  let size = 0;
  let dropping = false;
  function append(part: string): void {
    if (dropping || part.length === 0) return;
    size += part.length;
    if (size > maxFrameChars) { parts = []; dropping = true; return; }
    parts.push(part);
  }
  function finish(): string {
    const line = dropping ? '[diagnostic frame exceeded image projection limit]' : projectDiagnosticFrame({ line: parts.join('') }, { maxFrameChars });
    parts = []; size = 0; dropping = false;
    return line;
  }
  return {
    feed({ chunk }: { chunk: string }, _options = {}): string {
      const completed: string[] = [];
      let start = 0;
      for (let end = chunk.indexOf('\n'); end !== -1; end = chunk.indexOf('\n', start)) {
        append(chunk.slice(start, end)); completed.push(finish(), '\n'); start = end + 1;
      }
      append(chunk.slice(start));
      return completed.join('');
    },
    flush(_input: Record<string, never>, _options = {}): string { return size > 0 || dropping ? finish() : ''; },
  };
}
