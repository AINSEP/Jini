// Generic Server-Sent-Events frame parser. Framework- and transport-free:
// callers own how the raw text stream is split into `\n\n`-delimited frames
// (e.g. a `ReadableStream` reader) and pass each frame here.

export type ParsedSseFrame =
  | { kind: 'event'; event: string; data: Record<string, unknown>; id?: string }
  | { kind: 'comment'; comment: string }
  | { kind: 'empty' };

/**
 * Parse one SSE frame (the text between two `\n\n` boundaries) into its
 * `event` name, JSON-decoded `data`, and optional `id`, per the SSE wire
 * format (`event: `, `id: `, `data: `, and `: ` comment lines).
 *
 * @param frame - Raw frame text, without the trailing blank-line delimiter.
 * @returns `{ kind: 'event' }` for a frame with at least one `data:` line
 *   whose joined lines parse as JSON; `{ kind: 'comment' }` for a
 *   data-less frame that only carried `:`-prefixed comment lines;
 *   `{ kind: 'empty' }` for a frame with neither; `null` when `data:` lines
 *   are present but do not parse as JSON.
 * @complexity O(n) in the frame's line count — one linear scan.
 */
export function parseSseFrame({ frame }: { frame: string }): ParsedSseFrame | null {
  const lines = frame.split('\n');
  const comments: string[] = [];
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith(':')) {
      comments.push(line.slice(1).trimStart());
    } else if (line.startsWith('event: ')) {
      event = line.slice(7).trim();
    } else if (line.startsWith('id: ')) {
      id = line.slice(4).trim();
    } else if (line.startsWith('data: ')) {
      dataLines.push(line.slice(6));
    }
  }

  if (dataLines.length === 0) {
    if (comments.length > 0) {
      return { kind: 'comment', comment: comments.join('\n') };
    }
    return { kind: 'empty' };
  }

  try {
    return { kind: 'event', event, data: JSON.parse(dataLines.join('\n')), ...(id ? { id } : {}) };
  } catch {
    return null;
  }
}
