/**
 * The lines `proposedText` adds beyond the longest common line-prefix it
 * shares with `baseText` — a cheap "what's new" diff good enough for a
 * proposed-change preview (not a real diff algorithm: it only trims a
 * matching prefix, so a change in the middle of the text still shows every
 * line after the divergence point, not just the changed ones). Used for
 * both a revision's overall body and each of its per-file changes — the
 * origin duplicated this exact algorithm once for each.
 */
export function diffAddedLines({ baseText, proposedText }: { baseText: string; proposedText: string }, _optional: Record<string, never> = {}): string {
  const baseLines = baseText.split(/\r?\n/);
  const proposedLines = proposedText.split(/\r?\n/);
  let index = 0;
  while (index < baseLines.length && index < proposedLines.length && baseLines[index] === proposedLines[index]) {
    index += 1;
  }
  return proposedLines.slice(index).join('\n').trim();
}

/** Formats an ISO-ish timestamp as a short local date+time string, or returns the input unchanged if it doesn't parse. */
export function formatRevisionTimestamp({ value }: { value: string }, _optional: Record<string, never> = {}): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
