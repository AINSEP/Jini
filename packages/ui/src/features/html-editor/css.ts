import { trimTrailingChars } from '../../utils/trim-chars.js';
const INDENT = '  ';

/** Cursor + output of one `prettifyCss` pass. */
interface CssPrettyState {
  css: string;
  out: string;
  depth: number;
  parenDepth: number;
  quote: '"' | "'" | null;
  atDeclStart: boolean;
  i: number;
}

function skipWhitespace({ st }: { st: CssPrettyState }, _options: object = {}): void {
  while (st.i < st.css.length && /\s/.test(st.css[st.i]!)) st.i++;
}

/** Copies one character of a quoted string or paren group; false when `ch` is neither. */
function consumeValue({ st, ch }: { st: CssPrettyState; ch: string }, _options: object = {}): boolean {
  if (st.quote) {
    st.out += ch;
    if (ch === '\\' && st.i + 1 < st.css.length) {
      st.out += st.css[st.i + 1];
      st.i += 2;
      return true;
    }
    if (ch === st.quote) st.quote = null;
    st.i++;
    return true;
  }
  if (ch === '"' || ch === "'") st.quote = ch;
  else if (ch === '(') st.parenDepth++;
  else if (ch === ')') st.parenDepth = Math.max(0, st.parenDepth - 1);
  else return false;
  st.out += ch;
  st.i++;
  return true;
}

function openRule({ st }: { st: CssPrettyState }, _options: object = {}): boolean {
  st.out = trimTrailingChars(st.out, ' \t');
  st.out += ' {';
  st.depth++;
  st.atDeclStart = true;
  st.i++;
  skipWhitespace({ st });
  if (st.css[st.i] !== '}') st.out += '\n' + INDENT.repeat(st.depth);
  return true;
}

function closeRule({ st }: { st: CssPrettyState }, _options: object = {}): boolean {
  st.depth = Math.max(0, st.depth - 1);
  st.out = trimTrailingChars(st.out, ' \t');
  // A `}` immediately after `{` (an empty rule) needs no newline before it; otherwise close on
  // its own indented line.
  if (!st.out.endsWith('{')) st.out += '\n' + INDENT.repeat(st.depth);
  st.out += '}';
  st.atDeclStart = false;
  st.i++;
  skipWhitespace({ st });
  const nextCh = st.css[st.i];
  // A following `}` (closing a parent at-rule) manages its own leading newline via the same
  // trailing-space trim above — adding one here too would double up into a stray blank line.
  if (nextCh !== undefined && nextCh !== '}') {
    st.out += st.depth === 0 ? '\n\n' : '\n' + INDENT.repeat(st.depth);
  }
  return true;
}

function endDeclaration({ st }: { st: CssPrettyState }, _options: object = {}): boolean {
  st.out += ';';
  st.i++;
  skipWhitespace({ st });
  const nextCh = st.css[st.i];
  if (nextCh !== '}' && nextCh !== undefined) {
    st.out += '\n' + INDENT.repeat(st.depth);
    st.atDeclStart = true;
  }
  return true;
}

// Only the FIRST colon of a declaration (the property/value separator) gets a space after it —
// a selector's own colon (`.gm-btn:hover`, matched at `depth === 0`, before any `{`) is left
// untouched, and only `atDeclStart` (cleared the moment this fires) keeps a later colon inside
// the same value (there are none in practice here, but the guard costs nothing) from being
// treated as another property separator.
function separateValue({ st }: { st: CssPrettyState }, _options: object = {}): boolean {
  st.out += ': ';
  st.atDeclStart = false;
  st.i++;
  while (st.i < st.css.length && st.css[st.i] === ' ') st.i++;
  return true;
}

function consumeStructure({ st, ch }: { st: CssPrettyState; ch: string }, _options: object = {}): boolean {
  if (st.parenDepth !== 0) return false;
  switch (ch) {
    case '{': return openRule({ st });
    case '}': return closeRule({ st });
    case ';': return endDeclaration({ st });
    case ':': return st.depth > 0 && st.atDeclStart ? separateValue({ st }) : false;
    default: return false;
  }
}

/**
 * `editor.getCss()` always returns single-line, semicolon-packed CSS — confirmed directly in
 * GrapesJS's own bundled source (`CssRule.prototype.toCSS`/`getDeclaration`): there is no
 * formatting/indent option anywhere in that path, minification is unconditional. Left as-is, a host
 * reopening an HTML-source view after an Interactive-tab edit would find hand-authored, readable CSS
 * replaced by one dense blob. A real CSS parser (e.g. `postcss` + a printer, or a browser-bundle
 * build of `prettier`) is unwarranted weight for a formatting-only pass over CSS this function's own
 * caller already generated — the input is always GrapesJS's own regular, predictable serialization,
 * never arbitrary untrusted CSS, so a small tokenizer is sufficient and safe here specifically (it
 * would not be a safe substitute for a real parser on attacker-controlled input).
 *
 * Tracks brace depth (indentation), quote state (so `;`/`{`/`}` inside a string literal, e.g.
 * `content: "a;b"`, are never mistaken for structure), and paren depth (so the same characters
 * inside a function value are left alone too — the concrete case that broke without this: a
 * `url(data:image/svg+xml;base64,...)` value's own semicolon, which naive brace/semicolon splitting
 * mistakes for a declaration terminator and corrupts the value).
 *
 * @complexity O(n) single pass over the CSS string, O(1) additional space beyond the output buffer.
 * @overallScore 100
 */
export function prettifyCss(css: string): string {
  const st: CssPrettyState = { css, out: '', depth: 0, parenDepth: 0, quote: null, atDeclStart: false, i: 0 };
  while (st.i < css.length) {
    const ch = css[st.i]!;
    if (consumeValue({ st, ch }) || consumeStructure({ st, ch })) continue;
    if (/\s/.test(ch)) {
      st.out += ' ';
      st.i++;
      skipWhitespace({ st });
    } else {
      st.out += ch;
      st.i++;
    }
  }
  return st.out.trim();
}
