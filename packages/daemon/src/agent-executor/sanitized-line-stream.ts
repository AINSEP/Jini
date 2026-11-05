/** Frame and sanitize stdout before either parser or raw-event delivery.
 * @param required - Host byte cap, pure sanitizer and delivery/error sinks.
 * @returns A per-process stream; flush delivers a final unterminated line once.
 * @complexity O(n) time for n wire characters, O(maxBytes) retained text plus incoming chunk slices.
 * @example const stream = createSanitizedLineStream({ maxBytes: 4096, sanitize, emit, onOverflow });
 */
export function createSanitizedLineStream({ maxBytes, sanitize, emit, onOverflow }: {
  maxBytes: number;
  sanitize: (required: { fullText: string }) => string;
  emit: (required: { text: string }, optional?: Record<string, never>) => void;
  onOverflow: (required: { bytes: number }, optional?: Record<string, never>) => void;
}, _options: Record<string, never> = {}): {
  feed(required: { chunk: string }, optional?: Record<string, never>): void;
  flush(required: Record<string, never>, optional?: Record<string, never>): void;
} {
  let parts: string[] = [];
  let bytes = 0;
  let overflow = false;

  /** One line's fragments retain at most maxBytes; an oversized line is discarded through its end. */
  function append(text: string): void {
    if (!text) return;
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) { parts = []; overflow = true; }
    if (!overflow) parts.push(text);
  }

  /** Delivery happens once per completed line, or once for the final unterminated tail. */
  function flush(newline: string): void {
    if (overflow) onOverflow({ bytes });
    else if (bytes > 0 || newline) emit({ text: sanitize({ fullText: parts.join('') + newline }) });
    parts = []; bytes = 0; overflow = false;
  }

  return {
    feed({ chunk }, _optional = {}): void {
      const lines = chunk.split('\n');
      lines.forEach((line, index) => {
        append(line);
        if (index < lines.length - 1) flush('\n');
      });
    },
    flush(_required, _optional = {}): void { flush(''); },
  };
}
