import { CATEGORY, GENERATED_MARKER, MASK_AWARE_LABELED_SECRET_RE, URL_SECRET_PARAM_RE } from './redaction-patterns.js';
import { collectMatches, mergeSpans, type Span, type AddSpan, type SpanPass } from './redaction-spans.js';

/** Each usable secret plus its JSON-escaped spelling (`ab"cd` echoed inside JSON as `ab\"cd`). */
function exactNeedles(secrets: ReadonlyArray<string | undefined | null>, literalOnly = false): Set<string> {
  const needles = new Set<string>();
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    needles.add(secret);
    if (!literalOnly) needles.add(JSON.stringify(secret).slice(1, -1));
  }
  return needles;
}

/** Caller-supplied secrets as plain substrings at any length and every occurrence, overlapping
 * ones included (a secret glued into other text stays masked). Matching the original text retains every value rule
 * while wholly contained syntax occurrences preserve labels, markers and URL prefixes. Occurrences arrive
 * in start order and each one either extends the current run or starts the next, so the runs are
 * exactly the union of all occurrences.
 * @complexity O(e·n + s) for e needles, n text chars and s needle chars; consecutive overlapping
 * hits of one needle share a span. */
export function collectExactSecrets({ text, add, secrets }: SpanPass & { secrets: ReadonlyArray<string | undefined | null> }, options: { literalOnly?: boolean } = {}): void {
  const needles = exactNeedles(secrets, options.literalOnly);
  if (needles.size === 0) return;
  const protectedSyntax = options.literalOnly ? [] : exactSyntaxRanges({ text });
  for (const needle of needles) {
    const insideSyntax = syntaxContainment({ ranges: protectedSyntax });
    let runStart = -1;
    let runEnd = -1;
    forEachOccurrence(text, needle, (at) => {
      if (insideSyntax(at, at + needle.length)) return;
      if (beginsSecretRun({ at, runEnd, literalOnly: options.literalOnly === true })) {
        add(runStart, runEnd, CATEGORY.exactSecret);
        runStart = at;
      }
      runEnd = at + needle.length;
    });
    add(runStart, runEnd, CATEGORY.exactSecret);
  }
}

/** Preserve diagnostic syntax only when an exact occurrence fits wholly inside it.
 * Crossing a label/marker boundary still masks the complete secret, retaining span-union safety.
 * @complexity O(n + k) time/space over n characters and k syntax ranges; no I/O. */
function exactSyntaxRanges({ text }: { text: string }, _options = {}): Span[] {
  const ranges: Span[] = [];
  const add: AddSpan = (start, end) => { ranges.push({ start, end, category: 'syntax' }); };
  const pass = { text, add };
  collectMatches(pass, new RegExp(`${GENERATED_MARKER}|\\[redacted\\]`, 'gi'), (m, at) => ({ start: at, end: at + m[0].length, category: 'syntax' }));
  collectMatches(pass, MASK_AWARE_LABELED_SECRET_RE, (m, at) => ({ start: at, end: at + m[0].length - 1, category: 'syntax' }));
  collectMatches(pass, /\bBearer\s+|\bhttps?:\/\/|(?:x-api-key|api-key|x-goog-api-key)\s*[:=]\s*/gi,
    (m, at) => ({ start: at, end: at + m[0].length, category: 'syntax' }));
  collectMatches(pass, URL_SECRET_PARAM_RE, (m, at) => ({ start: at, end: at + m[0].indexOf('=') + 1, category: 'syntax' }));
  return mergeSpans(ranges);
}

/** Increasing occurrence starts let each needle visit every protected range at most once.
 * @complexity O(k + hits) across calls, O(1) retained state; no I/O. */
function syntaxContainment({ ranges }: { ranges: readonly Span[] }, _options = {}): (start: number, end: number) => boolean {
  let cursor = 0;
  return (start, end) => {
    while (cursor < ranges.length && ranges[cursor]!.end <= start) cursor++;
    const range = ranges[cursor];
    return range !== undefined && range.start <= start && range.end >= end;
  };
}

/** Heuristic union joins adjacent hits; exact-only retains one marker for each adjacent occurrence. */
function beginsSecretRun({ at, runEnd, literalOnly }: { at: number; runEnd: number; literalOnly: boolean }, _options = {}): boolean {
  return literalOnly ? at >= runEnd : at > runEnd;
}

/** Calls `visit` with the start of every occurrence of `needle` in order, overlapping ones included.
 * Knuth-Morris-Pratt: after a hit the scan keeps the needle's longest border instead of retrying one
 * character later (which cost Θ(n·m) on long overlapping needles), so no text character is read
 * twice; while no partial match is pending, native indexOf skips to the next occurrence.
 * @complexity O(n + m) time, O(m) space for n text and m needle chars. */
function forEachOccurrence(text: string, needle: string, visit: (start: number) => void): void {
  const border = borderTable(needle);
  let matched = 0;
  let at = text.indexOf(needle);
  while (at !== -1) {
    const char = text.charCodeAt(at);
    while (matched > 0 && char !== needle.charCodeAt(matched)) matched = border[matched - 1] ?? 0;
    if (char === needle.charCodeAt(matched)) matched += 1;
    if (matched === needle.length) {
      visit(at + 1 - needle.length);
      matched = border[matched - 1] ?? 0;
    }
    at = nextSearchOffset({ text, needle, at, matched });
  }
}

/** Keep partial KMP matches moving one character at a time; native indexOf skips unmatched runs. */
function nextSearchOffset({ text, needle, at, matched }: { text: string; needle: string; at: number; matched: number }, _options = {}): number {
  const next = at + 1;
  if (next >= text.length) return -1;
  return matched === 0 ? text.indexOf(needle, next) : next;
}

/** KMP failure table: `border[i]` is the length of the longest proper prefix of `needle[0..i]` that
 * is also its suffix. @complexity O(m) time and space. */
function borderTable(needle: string): Int32Array {
  const border = new Int32Array(needle.length);
  let length = 0;
  for (let i = 1; i < needle.length; i += 1) {
    const char = needle.charCodeAt(i);
    while (length > 0 && char !== needle.charCodeAt(length)) length = border[length - 1] ?? 0;
    if (char === needle.charCodeAt(length)) length += 1;
    border[i] = length;
  }
  return border;
}
