/**
 * @file The references `/\burl\(\s*["']?([^"')]+)["']?\s*\)/gi` captures from CSS, found by a
 * linear scan instead of that pattern's backtracking over whitespace runs and unterminated
 * references. Each quote is optional on its own, as in the pattern.
 */

const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);
const isQuote = (ch: string | undefined): boolean => ch === '"' || ch === "'";
const isWordChar = (ch: string | undefined): boolean => ch !== undefined && /\w/.test(ch);

function skipSpaces(text: string, index: number): number {
  let i = index;
  while (isSpace(text[i])) i += 1;
  return i;
}

/** End of the run of characters other than quotes and `)` starting at `index`. */
function refRunEnd(text: string, index: number): number {
  let i = index;
  while (i < text.length && !`"')`.includes(text[i]!)) i += 1;
  return i;
}

/** Index just past the reference's `)`: directly after it, or after one quote and whitespace; -1 if neither. */
function closeOfRef(text: string, end: number): number {
  if (text[end] === ')') return end + 1;
  if (!isQuote(text[end])) return -1;
  const close = skipSpaces(text, end + 1);
  return text[close] === ')' ? close + 1 : -1;
}

interface FoundRef { readonly ref: string; readonly end: number }

/** After an opening quote. `url( ')` captures the space before the lone quote: the pattern
 *  backtracks out of its leading `\s*` when nothing follows the quote. */
function quotedRef(text: string, start: number, quoteAt: number): FoundRef | null {
  const end = refRunEnd(text, quoteAt + 1);
  if (end === quoteAt + 1) return quoteAt > start && text[end] === ')' ? { ref: text[quoteAt - 1]!, end: end + 1 } : null;
  const close = closeOfRef(text, end);
  return close < 0 ? null : { ref: text.slice(quoteAt + 1, end), end: close };
}

/** The reference after `url(` at `start` (the index just past the parenthesis), or null. */
function refAt(text: string, start: number): FoundRef | null {
  const first = skipSpaces(text, start);
  if (isQuote(text[first])) return quotedRef(text, start, first);
  if (text[first] === ')') return first > start ? { ref: text[first - 1]!, end: first + 1 } : null;
  const end = refRunEnd(text, first);
  const close = end > first ? closeOfRef(text, end) : -1;
  return close < 0 ? null : { ref: text.slice(first, end), end: close };
}

/** Every `url(...)` reference in `text`, in order, exactly as the pattern's group captured it. */
export function cssUrlRefs(text: string): string[] {
  const refs: string[] = [];
  const opener = /url\(/gi;
  for (let open = opener.exec(text); open; open = opener.exec(text)) {
    // `\b` before `url`: the opener may not continue a word.
    const found = isWordChar(text[open.index - 1]) ? null : refAt(text, open.index + 4);
    if (found) {
      refs.push(found.ref);
      opener.lastIndex = found.end;
    }
  }
  return refs;
}
