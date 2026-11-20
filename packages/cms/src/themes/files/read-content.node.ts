export type ThemeReadSelection =
  | { mode: "full" }
  | { mode: "window"; startLine: number; lineCount: number }
  | { mode: "find"; find: string; context: number; startLine: number; lineCount?: number };


/** One merged `[start, end)` line interval of a find result. */
interface ThemeReadWindow {
  start: number;
  end: number;
}

/**
 * Finds up to 50 matching lines and merges overlapping or adjacent context intervals.
 * Caps each window at 2,000 characters and each result at 4,000; the existing 20-item
 * batch limit therefore bounds find content at 80,000 characters per batch.
 * @param required.lines - File lines retaining their original terminators.
 * @param required.options - Validated substring and context count.
 * @returns Text in file order, capped match count, overflow signal and narrowing hint when cut.
 * @complexity O(b) time/space in file text size; returned text is bounded even for minified lines.
 */
function findThemeReadWindows(
  { lines, options, truncationHint }: { lines: string[]; options: Extract<ThemeReadSelection, { mode: "find" }>; truncationHint: string },
  _optional = {}
) {
  const found = collectThemeReadMatches({ lines, options });
  const rendered = renderThemeReadWindows({ lines, windows: found.windows, find: options.find });
  const truncated = found.truncated || rendered.truncated;
  return {
    content: rendered.content,
    returned: { matches: found.matches, truncated,
      ...(truncated ? { hint: truncationHint } : {}),
    },
  };
}

/**
 * The find pass of {@link findThemeReadWindows}: every matching line inside the selected range (up
 * to 50; a 51st sets `truncated`), each widened by `context` lines clamped to the range, merged
 * into file-ordered windows.
 * @complexity O(r) in the selected range's line count.
 */
function collectThemeReadMatches(required: { lines: string[]; options: Extract<ThemeReadSelection, { mode: "find" }> }): {
  windows: ThemeReadWindow[];
  matches: number;
  truncated: boolean;
} {
  const { lines, options } = required;
  const windows: ThemeReadWindow[] = [];
  let matches = 0;
  const rangeStart = options.startLine - 1;
  const rangeEnd = Math.min(lines.length, options.lineCount === undefined ? lines.length : rangeStart + options.lineCount);
  for (let index = rangeStart; index < rangeEnd; index++) {
    if (!lines[index]?.includes(options.find)) continue;
    if (matches === 50) return { windows, matches, truncated: true };
    matches++;
    mergeThemeReadWindow({
      windows,
      window: { start: Math.max(rangeStart, index - options.context), end: Math.min(rangeEnd, index + options.context + 1) },
    });
  }
  return { windows, matches, truncated: false };
}

/**
 * Append `window` to the file-ordered `windows`, extending the last one instead when the two overlap
 * or touch. Mutates `windows` (the caller's own accumulator).
 * @complexity O(1).
 */
function mergeThemeReadWindow(required: { windows: ThemeReadWindow[]; window: ThemeReadWindow }): void {
  const { windows, window } = required;
  const previous = windows.at(-1);
  if (previous && window.start <= previous.end) previous.end = window.end;
  else windows.push(window);
}

/**
 * The text pass of {@link findThemeReadWindows}: join each window's lines, capping each at 2,000
 * characters and the whole result at 4,000. `truncated` when any text was cut or windows remained.
 * @complexity O(b) in the windows' text size.
 */
function renderThemeReadWindows(required: { lines: string[]; windows: readonly ThemeReadWindow[]; find: string }): {
  content: string;
  truncated: boolean;
} {
  const { lines, windows, find } = required;
  let content = "";
  let truncated = false;
  for (const { start, end } of windows) {
    const limit = Math.min(2_000, 4_000 - content.length);
    if (limit === 0) return { content, truncated: true };
    const text = lines.slice(start, end).join("");
    // Keep the match visible when a minified line or its surrounding context exceeds the cap.
    const offset = text.length > limit ? Math.max(0, text.indexOf(find) - Math.floor(limit / 2)) : 0;
    content += text.slice(offset, offset + limit);
    if (text.length > limit) truncated = true;
  }
  return { content, truncated };
}

/**
 * Selects file text without changing LF/CRLF bytes or inventing a line after a final newline.
 * @param required.content - Complete decoded file text, already checked against the 1 MB read limit.
 * @param required.selection - Validated window or find selection.
 * @returns Selected content, full-file line count and selection metadata. Empty files have 0 lines.
 * @complexity O(b) time and space in the bounded file size; substring length is capped at 200.
 */
export function selectThemeReadContent(
  { content, selection, truncationHint }: { content: string; selection: Exclude<ThemeReadSelection, { mode: "full" }>; truncationHint: string },
  _optional = {}
) {
  const lines = content.match(/\n|[^\n]+\n?/g) ?? [];
  if (selection.mode === "find") return { ...findThemeReadWindows({ lines, options: selection, truncationHint }), totalLines: lines.length };
  const start = selection.startLine - 1;
  const end = Math.min(lines.length, start + selection.lineCount);
  return { content: lines.slice(start, end).join(""), totalLines: lines.length,
    returned: { startLine: selection.startLine, endLine: end } };
}

/** Whether the byte at `index` sits inside a UTF-8 character rather than starting one. An index at
 * the very end of the text has no byte: that is a boundary, so the answer is no.
 * @complexity O(1). */
function isUtf8ContinuationByte({ bytes, index }: { bytes: Buffer; index: number }, _options = {}): boolean {
  const byte = bytes[index];
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

/** Bound theme read results even when one CSS line fills the whole file. Uses library_read's
 * offset/nextOffset UTF-8 byte convention, retaining whole characters and the small-read shape.
 * @param required.content Selected theme text; offset is validated by the tool boundary.
 * @throws Error for a cursor outside the selection or inside a UTF-8 character.
 * @complexity O(b) time/space in selected text, bounded by the existing 1 MB file ceiling.
 */
export function pageThemeReadContent({ content, offset, invalidOffsetError }: { content: string; offset: number | undefined; invalidOffsetError: (required: {}, optional?: {}) => Error }, _options = {}) {
  const bytes = Buffer.from(content, "utf8");
  const start = offset ?? 0;
  if (start > bytes.length || isUtf8ContinuationByte({ bytes, index: start })) {
    throw invalidOffsetError({});
  }
  if (offset === undefined && bytes.length <= 4000) return { content };
  let end = Math.min(bytes.length, start + 4000);
  while (end < bytes.length && isUtf8ContinuationByte({ bytes, index: end })) end--;
  const truncated = end < bytes.length;
  return { content: bytes.subarray(start, end).toString("utf8"), offset: start,
    nextOffset: truncated ? end : null, totalBytes: bytes.length, truncated };
}
