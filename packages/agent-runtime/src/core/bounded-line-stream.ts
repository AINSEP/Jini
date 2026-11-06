/** Maximum retained physical stdout line, measured in JavaScript UTF-16 code units. */
export const MAX_STREAM_LINE_CHARS = 8 * 1024 * 1024;
export const STREAM_LINE_LIMIT_MESSAGE = 'Agent output is too large to read: one line exceeds 8,388,608 characters. Try a smaller attachment or a new chat.';

/** Frame bounded physical lines without ever parsing an oversized line's suffix.
 * Overflow is reported once, immediately, then discarded through newline. Flush clears a final tail.
 * @complexity O(incoming characters) time; O(MAX_STREAM_LINE_CHARS) retained text plus chunk references.
 */
export function createBoundedLineStream({ onLine, onOverflow }: {
  onLine: (line: string) => void;
  onOverflow: (error: RangeError) => void;
}, _optional: Record<string, never> = {}) {
  let parts: string[] = [];
  let length = 0;
  let dropping = false;

  function append(chunk: string, start: number, end: number): void {
    if (dropping || start === end) return;
    const nextLength = length + end - start;
    if (nextLength > MAX_STREAM_LINE_CHARS) {
      parts = []; length = 0; dropping = true;
      onOverflow(new RangeError(STREAM_LINE_LIMIT_MESSAGE));
      return;
    }
    parts.push(chunk.slice(start, end));
    length = nextLength;
  }

  function finishLine(): void {
    const line = dropping ? null : parts.join('');
    parts = []; length = 0; dropping = false;
    if (line !== null) onLine(line);
  }

  return {
    feed({ chunk }: { chunk: string }): void {
      let start = 0;
      let newline = chunk.indexOf('\n', start);
      while (newline !== -1) {
        append(chunk, start, newline);
        finishLine();
        start = newline + 1;
        newline = chunk.indexOf('\n', start);
      }
      append(chunk, start, chunk.length);
    },
    flush(): void { finishLine(); },
  };
}
