/** One CSS `url(...)` token: its span in the source, the quote it used ('' when bare) and the raw value. */
export interface CssUrlToken { start: number; end: number; quote: string; value: string }

const VALUE_STOP = "'\")";
const isSpace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char);

/**
 * Every `url(...)` token, exactly as `css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)` finds them
 * (including that pattern's corner case where `url(  )` captures the last space as the value), but
 * scanned in linear time: the regex backtracks quadratically because its whitespace runs and value
 * run overlap.
 * @complexity O(css length).
 */
export function cssUrlTokens(css: string): CssUrlToken[] {
  const tokens: CssUrlToken[] = [];
  const stops = createStopFinder(css);
  let from = css.indexOf('url(');
  while (from !== -1) {
    const token = cssUrlTokenAt(css, from, stops);
    if (token) tokens.push(token);
    from = css.indexOf('url(', token ? token.end : from + 1);
  }
  return tokens;
}

/** Index of the first `'`, `"` or `)` at or after a position; positions only grow, so one scan serves all. */
function createStopFinder(css: string): (position: number) => number {
  let found = -1;
  return (position) => {
    if (found >= position) return found;
    found = position;
    while (found < css.length && !VALUE_STOP.includes(css.charAt(found))) found += 1;
    return found;
  };
}

function skipSpaces(css: string, position: number): number {
  let index = position;
  while (isSpace(css[index])) index += 1;
  return index;
}

function cssUrlTokenAt(css: string, start: number, stopAt: (position: number) => number): CssUrlToken | null {
  const open = start + 'url('.length;
  const valueStart = skipSpaces(css, open);
  const quote = css.charAt(valueStart);
  if (quote === "'" || quote === '"') return quotedToken({ css, start, quote, valueStart: valueStart + 1, stopAt });
  const valueEnd = stopAt(valueStart);
  if (css[valueEnd] !== ')') return null;
  if (valueEnd > valueStart) return { start, end: valueEnd + 1, quote: '', value: css.slice(valueStart, valueEnd) };
  // An empty value can only borrow the last leading space, as the regex's backtracking does.
  if (valueStart > open) return { start, end: valueEnd + 1, quote: '', value: css.charAt(valueStart - 1) };
  return null;
}

function quotedToken(input: { css: string; start: number; quote: string; valueStart: number; stopAt: (position: number) => number }): CssUrlToken | null {
  const { css, start, quote, valueStart, stopAt } = input;
  const valueEnd = stopAt(valueStart);
  if (valueEnd === valueStart || css[valueEnd] !== quote) return null;
  const close = skipSpaces(css, valueEnd + 1);
  if (css[close] !== ')') return null;
  return { start, end: close + 1, quote, value: css.slice(valueStart, valueEnd) };
}
