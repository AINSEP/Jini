// Generic Server-Sent-Events frame parser. Framework- and transport-free:
// callers own how the raw text stream is split into `\n\n`-delimited frames
// (e.g. a `ReadableStream` reader) and pass each frame here.

export type ParsedSseFrame =
  | { kind: 'event'; event: string; data: Record<string, unknown>; id?: string }
  | { kind: 'comment'; comment: string }
  | { kind: 'empty' };

interface SseFrameFields {
  event: string;
  id: string | undefined;
  comments: string[];
  dataLines: string[];
}

/** Fold one frame line (any trailing `\r` already stripped) into the accumulated fields. */
function applySseLine({ fields, line }: { fields: SseFrameFields; line: string }): void {
  if (line.startsWith(':')) {
    fields.comments.push(line.slice(1).trimStart());
  } else if (line.startsWith('event: ')) {
    fields.event = line.slice(7).trim();
  } else if (line.startsWith('id: ')) {
    fields.id = line.slice(4).trim();
  } else if (line.startsWith('data: ')) {
    fields.dataLines.push(line.slice(6));
  }
}

/** Build the result for a frame that carried no `data:` lines. */
function dataLessFrame({ comments }: { comments: string[] }): ParsedSseFrame {
  return comments.length > 0 ? { kind: 'comment', comment: comments.join('\n') } : { kind: 'empty' };
}

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
  const fields: SseFrameFields = { event: 'message', id: undefined, comments: [], dataLines: [] };
  for (const rawLine of frame.split('\n')) {
    applySseLine({ fields, line: rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine });
  }

  if (fields.dataLines.length === 0) return dataLessFrame({ comments: fields.comments });

  const { event, id } = fields;
  try {
    return { kind: 'event', event, data: JSON.parse(fields.dataLines.join('\n')), ...(id ? { id } : {}) };
  } catch {
    return null;
  }
}
