import { CATEGORY, QUOTED_SECRET_VALUE, EMPTY_QUOTED_ASSIGNMENT_RE, MASK_AWARE_LABELED_SECRET_RE, CHAINED_LABEL_RE, URL_SECRET_PARAM_RE, isMaskedValue } from './redaction-patterns.js';
import type { Span, SpanPass } from './redaction-spans.js';

/** Label values (`password=...`): only the value is masked, so the label stays readable
 * even when no whitespace separates it; a glued credential suffix fails the complete-marker check.
 * A label whose value an earlier rule already masks (see {@link isCoveredField}) is skipped and the
 * scan resumes at the value, so `api-key=x;password=y` and `?password=x&page=2` keep the following
 * field instead of masking it beside the first value. A masked value resumes the scan past its end.
 * @complexity O(n + k) for n chars and k earlier spans; each skip resumes past the label and value
 * ends come from forward-only finders, so no run is rescanned. */
export function collectLabeledSecrets({ text, add }: SpanPass, earlier: readonly Span[]): void {
  const covered = coveredLabelFields({ earlier });
  const hints = emptyAssignmentRanges(text);
  const extentOf = labelValueExtents(text);
  const regex = new RegExp(MASK_AWARE_LABELED_SECRET_RE.source, MASK_AWARE_LABELED_SECRET_RE.flags);
  const chained = new RegExp(CHAINED_LABEL_RE.source, CHAINED_LABEL_RE.flags);
  const urlField = new RegExp(URL_SECRET_PARAM_RE.source, 'iy');
  for (let match = regex.exec(text); match; match = regex.exec(text)) {
    if (hints.has(match.index)) continue;
    // The URL collector owns complete unquoted parameter values, including quote boundaries.
    // A generic unquoted label would consume the URL's enclosing quote as a secret byte.
    urlField.lastIndex = Math.max(0, match.index - 1);
    if (urlField.exec(text)) {
      regex.lastIndex = urlField.lastIndex;
      continue;
    }
    const start = match.index + match[0].length - 1;
    chained.lastIndex = start;
    if (chained.test(text)) {
      regex.lastIndex = start;
      continue;
    }
    const value = extentOf(start);
    if (covered(start, value) || isMaskedValue(text.slice(start, value.end))) {
      regex.lastIndex = start;
      continue;
    }
    addLabelValue({ text, add, start, value });
    regex.lastIndex = value.end;
  }
}

/** Preserve quoted diagnostic/JSON values, including the closing quote on truncated echoes. */
function addLabelValue({ text, add, start, value }: SpanPass & { start: number; value: LabelValue }): void {
  const quoted = value.quoted ? 1 : 0;
  const closed = value.closingQuote === value.end - 1;
  add(start + quoted, value.end - (quoted && closed ? 1 : 0), CATEGORY.labeledSecret, quoted ? (closed ? '' : text[start]) : undefined);
}

/** Index earlier spans once so each label's coverage check takes O(1), including dense headers.
 * No I/O; O(k) time/space for k earlier spans. */
function coveredLabelFields({ earlier }: { earlier: readonly Span[] }): (start: number, value: LabelValue) => boolean {
  // Per earlier span start: the furthest end (scalars rather than per-start end lists:
  // dense fields yield millions of spans). A separator proves coverage only at the full value end.
  const furthest = new Map<number, number>();
  for (const { start, end } of earlier) {
    furthest.set(start, Math.max(furthest.get(start) ?? end, end));
  }
  return (start, value) => {
    const at = !value.quoted || furthest.has(start) ? start : start + 1;
    return isCoveredField(furthest.get(at), value);
  };
}

/** Where a label value ends; `closingQuote` is -1 for an unquoted or unclosed value. */
interface LabelValue {
  end: number;
  closingQuote: number;
  quoted: boolean;
}

/** True when an earlier span starting at the label value (inside its opening quote, for a quoted
 * value) masks it: `reach` is the furthest such span end.
 * Inside quotes only the closing quote ends the value (`;` and `&` are value text:
 * `password="sk-...;hunter2"` once left `hunter2`); unquoted values also need complete coverage
 * so a provider-prefix rule ending at `;`/`&` cannot leave the rest of a secret visible. */
function isCoveredField(reach: number | undefined, { end, closingQuote }: LabelValue): boolean {
  const target = closingQuote === end - 1 ? closingQuote : end;
  return (reach ?? -1) >= target;
}

/** Extent finder for label values whose starts increase between calls. An unquoted value runs to
 * whitespace or a `;`/`&` followed by a new label (or end of text). Quotes inside an unquoted
 * secret are secret bytes, not terminators. A quoted value runs through its closing quote (a backslash-escaped quote does not
 * close it) and any text glued after it up to whitespace, `;`, `&` or `,` (`"abc def"hunter2` once
 * left `hunter2`), or to the line end when the quote never closes, so spaces, `;` and `&` inside
 * quotes stay in the value. Structured field delimiters after a closing quote stay readable.
 * @complexity Amortized O(1) per call; all calls together scan the text once per finder. */
function labelValueExtents(text: string): (start: number) => LabelValue {
  const runEnd = forwardFinder(text, /\s|[;&](?=$|[\w.-]+\s*[:=])/);
  const gluedEnd = forwardFinder(text, /[\s;&,}\]]/);
  const lineEnd = forwardFinder(text, /[\r\n]/);
  const closers = new Map([['"', unescapedQuoteFinder(text, /"/)], ["'", unescapedQuoteFinder(text, /'/)]]);
  return (start) => {
    const whitespace = runEnd(start);
    const closer = closers.get(text[start] ?? '');
    if (!closer) return { end: whitespace, closingQuote: -1, quoted: false };
    const closing = closer(start + 1);
    const line = lineEnd(start);
    return closing < text.length
      ? { end: quotedValueEnd({ text, closing, gluedEnd: gluedEnd(closing + 1) }), closingQuote: closing, quoted: true }
      : { end: line, closingQuote: -1, quoted: true };
  };
}

/** `forwardFinder` for a quote that skips backslash-escaped ones: an odd run of backslashes before a
 * quote escapes it (`\\"` is an escaped backslash, then a real quote). Same non-decreasing `from` rule.
 * @complexity O(n) over all calls: each quote's backslash run is counted once. */
function unescapedQuoteFinder(text: string, quote: RegExp): (from: number) => number {
  const next = forwardFinder(text, quote);
  let found = -1;
  return (from) => {
    if (from > found) {
      found = next(from);
      while (found < text.length && isBackslashEscaped(text, found)) found = next(found + 1);
    }
    return found;
  };
}

/** True when an odd run of backslashes ends right before `index`. */
function isBackslashEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  while (text[index - 1 - backslashes] === '\\') backslashes++;
  return backslashes % 2 === 1;
}

/** `find(from)`: the first index at or after `from` matching `pattern`, or `text.length`. `from` must
 * not decrease between calls: one search answers every later `from` up to its result, since nothing
 * matched between the earlier `from` and that result.
 * @complexity O(n) over all calls for n chars. */
function forwardFinder(text: string, pattern: RegExp): (from: number) => number {
  const regex = new RegExp(pattern.source, 'g');
  let found = -1;
  return (from) => {
    if (from > found) {
      regex.lastIndex = from;
      found = regex.exec(text)?.index ?? text.length;
    }
    return found;
  };
}

/** Quoted empty credential hints must not borrow the next field's key as their value. */
export function emptyAssignmentRanges(text: string): Set<number> {
  const starts = new Set<number>();
  for (const match of text.matchAll(new RegExp(QUOTED_SECRET_VALUE, 'g'))) {
    if (!EMPTY_QUOTED_ASSIGNMENT_RE.test(match[0].slice(1, -1))) continue;
    // Only credential-label starts inside this quoted hint need skipping; no per-character index.
    const labels = new RegExp(MASK_AWARE_LABELED_SECRET_RE.source, 'gi');
    for (const label of match[0].matchAll(labels)) starts.add(match.index + label.index);
  }
  return starts;
}

/** Preserve the hint's quotes and neighboring fields; O(n) scan, no I/O. */
export function collectEmptyQuotedAssignments(pass: SpanPass): void {
  for (const match of pass.text.matchAll(new RegExp(QUOTED_SECRET_VALUE, 'g'))) {
    if (EMPTY_QUOTED_ASSIGNMENT_RE.test(match[0].slice(1, -1))) {
      pass.add(match.index + 1, match.index + match[0].length - 1, CATEGORY.labeledSecret);
    }
  }
}

/** Standalone diagnostic punctuation stays readable; punctuation glued to credential text is masked. */
function quotedValueEnd({ text, closing, gluedEnd }: { text: string; closing: number; gluedEnd: number }, _options = {}): number {
  return /^[.!)]*$/.test(text.slice(closing + 1, gluedEnd)) ? closing + 1 : gluedEnd;
}
