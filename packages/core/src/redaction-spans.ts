import { isMaskedValue } from './redaction-patterns.js';

/** A half-open `[start, end)` range of the original input that one rule masks. */
export interface Span {
  start: number;
  end: number;
  category: string;
  suffix?: string | undefined;
}

/** Records a span; empty ranges are dropped. */
export type AddSpan = (start: number, end: number, category: string, suffix?: string) => void;

export interface SpanPass {
  text: string;
  add: AddSpan;
}

interface MergedSpan extends Span {
  rank: number;
  categoryLength: number;
}

/** Orders spans and merges overlapping or adjacent ones; masking whole merged runs means no rule's
 * leftover can expose part of another rule's value.
 * Category rule: the longest constituent span names the merged span; on a tie the earlier rule in
 * {@link collectSpans} wins, so an exact rule labels a known secret it matches exactly
 * (`t=<known-token>` stays `exact_secret`) and the exact-secret category marks what only it covers.
 * @complexity O(k) time and space for k spans (string offsets fit in unsigned 32 bits). */
export function mergeSpans(spans: readonly Span[], { keepAdjacent = false } = {}): Span[] {
  const merged: MergedSpan[] = [];
  for (const rank of orderedSpanRanks({ spans })) {
    const span = spans[rank]!;
    const length = span.end - span.start;
    const last = merged.at(-1);
    if (!last || startsSeparateSpan({ start: span.start, end: last.end, keepAdjacent })) {
      merged.push({ start: span.start, end: span.end, category: span.category, suffix: span.suffix, rank, categoryLength: length });
      continue;
    }
    if (span.end >= last.end) last.suffix = span.suffix;
    last.end = Math.max(last.end, span.end);
    if (length > last.categoryLength || (length === last.categoryLength && rank < last.rank)) {
      Object.assign(last, { category: span.category, rank, categoryLength: length });
    }
  }
  return merged;
}

/** Literal-only replacements preserve adjacent occurrences as distinct markers and counts. */
function startsSeparateSpan({ start, end, keepAdjacent }: { start: number; end: number; keepAdjacent: boolean }, _options = {}): boolean {
  return keepAdjacent ? start >= end : start > end;
}

/** Stable byte-wise radix order of span starts; ranks retain the original rule precedence.
 * Dense labels produce millions of spans: sorting cloned objects both cost k log k and amplified
 * GC. Four counting passes over integer ranks avoid those clones and bound work to O(k), with
 * O(k) scratch space. JavaScript string offsets fit in 32 bits. No caller-owned data is mutated. */
function orderedSpanRanks({ spans }: { spans: readonly Span[] }): Uint32Array {
  let ranks = Uint32Array.from(spans, (_span, rank) => rank);
  let scratch = new Uint32Array(ranks.length);
  const offsets = new Uint32Array(256);
  for (let shift = 0; shift < 32; shift += 8) {
    offsets.fill(0);
    for (const rank of ranks) {
      const bucket = (spans[rank]!.start >>> shift) & 255;
      offsets[bucket] = (offsets[bucket] ?? 0) + 1;
    }
    let total = 0;
    for (let bucket = 0; bucket < offsets.length; bucket++) {
      const count = offsets[bucket] ?? 0;
      offsets[bucket] = total;
      total += count;
    }
    for (const rank of ranks) {
      const bucket = (spans[rank]!.start >>> shift) & 255;
      const position = offsets[bucket] ?? 0;
      scratch[position] = rank;
      offsets[bucket] = position + 1;
    }
    [ranks, scratch] = [scratch, ranks];
  }
  return ranks;
}

/** Adds one span per match of `regex`; `spanOf` maps a match to its value range, or skips it. */
export function collectMatches(
  { text, add }: SpanPass,
  regex: RegExp,
  spanOf: (match: RegExpMatchArray, index: number) => Span | undefined,
): void {
  // Clone so a caller-owned or shared regex never carries lastIndex state across requests;
  // non-global extra patterns use the same every-occurrence contract as the built-ins.
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  for (const match of text.matchAll(new RegExp(regex.source, flags))) {
    const span = spanOf(match, match.index ?? 0);
    if (span) add(span.start, span.end, span.category);
  }
}

/** Span of the match's trailing capture `group`, unless that value is already a generated marker
 * (already masked values are not new credentials and should not inflate the audit count). */
export function trailingValue(category: string, group: number) {
  return (match: RegExpMatchArray, index: number): Span | undefined => {
    const value = match[group] ?? '';
    if (isMaskedValue(value)) return undefined;
    const end = index + match[0].length;
    return { start: end - value.length, end, category };
  };
}
