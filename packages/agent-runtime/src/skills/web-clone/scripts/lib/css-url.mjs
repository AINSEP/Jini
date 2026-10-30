// Linear-time scanning of CSS `url(...)` references. `replaceCssUrls` gives the same result as
// `text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, replacer)` (optionally only for references
// `accept` admits), edge cases included, without that regex's backtracking on long whitespace
// runs and unterminated references.

const STOP_CHARS = `'")`;

const isSpace = (ch) => ch !== undefined && /\s/.test(ch);
const isQuote = (ch) => ch === "'" || ch === '"';

function skipSpace(text, index) {
  let i = index;
  while (isSpace(text[i])) i += 1;
  return i;
}

// First index at or after `index` holding a quote or ")" (or the text length). Successive
// calls with non-decreasing indexes reuse the previous scan, keeping a whole pass linear.
function createRunEnd(text) {
  let cachedStart = -1;
  let cachedEnd = -1;
  return (index) => {
    if (index >= cachedStart && index <= cachedEnd) return cachedEnd;
    let i = index;
    while (i < text.length && !STOP_CHARS.includes(text[i])) i += 1;
    cachedStart = index;
    cachedEnd = i;
    return i;
  };
}

// `url(` W* q R q W* `)` with a matching quote q and a non-empty R.
function quotedRef(text, quoteAt, runEnd) {
  const quote = text[quoteAt];
  const end = runEnd(quoteAt + 1);
  if (end === quoteAt + 1 || text[end] !== quote) return null;
  const close = skipSpace(text, end + 1);
  return text[close] === ")" ? { quote, ref: text.slice(quoteAt + 1, end), end: close + 1 } : null;
}

// The reference after "url(" at `start`, as the regex above would capture it, or null.
// Unquoted, the reference runs up to the ")" (keeping trailing whitespace); `url(  )` captures
// its last whitespace character, because the regex backtracks one character out of `\s*`.
function cssUrlAt(text, start, runEnd) {
  const first = skipSpace(text, start);
  if (isQuote(text[first])) return quotedRef(text, first, runEnd);
  if (text[first] === ")") return first > start ? { quote: "", ref: text[first - 1], end: first + 1 } : null;
  const end = runEnd(first);
  return end > first && text[end] === ")" ? { quote: "", ref: text.slice(first, end), end: end + 1 } : null;
}

/**
 * Replaces each `url(...)` reference with `replacer(match, quote, ref)`. With `accept`, a
 * reference it rejects is not a match at all, exactly as if the regex's reference group carried
 * that extra condition.
 */
export function replaceCssUrls(text, replacer, { accept = () => true } = {}) {
  const runEnd = createRunEnd(text);
  const opener = /url\(/gi;
  let out = "";
  let copied = 0;
  for (let open = opener.exec(text); open; open = opener.exec(text)) {
    const found = cssUrlAt(text, open.index + 4, runEnd);
    if (found && accept(found.ref)) {
      out += text.slice(copied, open.index) + replacer(text.slice(open.index, found.end), found.quote, found.ref);
      copied = found.end;
      opener.lastIndex = found.end;
    }
  }
  return out + text.slice(copied);
}
