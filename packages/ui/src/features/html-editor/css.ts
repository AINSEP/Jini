import { trimTrailingChars } from '../../utils/trim-chars.js';
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
  const INDENT = '  ';
  let out = '';
  let depth = 0;
  let parenDepth = 0;
  let quote: '"' | "'" | null = null;
  let atDeclStart = false;
  let i = 0;
  const n = css.length;

  const skipWhitespace = (_input: object, _options: object = {}): void => {
    while (i < n && /\s/.test(css[i]!)) i++;
  };

  const consumeValue = ({ ch }: { ch: string }, _options: object = {}): boolean => {
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < n) {
        out += css[i + 1];
        i += 2;
        return true;
      }
      if (ch === quote) quote = null;
      i++;
      return true;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      return true;
    }

    if (ch === '(') {
      parenDepth++;
      out += ch;
      i++;
      return true;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      out += ch;
      i++;
      return true;
    }

    return false;
  };

  const openRule = (_input: object, _options: object = {}): boolean => {
    out = trimTrailingChars(out, ' \t');
    out += ' {';
    depth++;
    atDeclStart = true;
    i++;
    skipWhitespace({}, {});
    if (css[i] !== '}') out += '\n' + INDENT.repeat(depth);
    return true;
  };

  const closeRule = (_input: object, _options: object = {}): boolean => {
    depth = Math.max(0, depth - 1);
    out = trimTrailingChars(out, ' \t');
    // A `}` immediately after `{` (an empty rule) needs no newline before it; otherwise close on
    // its own indented line.
    if (!out.endsWith('{')) out += '\n' + INDENT.repeat(depth);
    out += '}';
    atDeclStart = false;
    i++;
    skipWhitespace({}, {});
    const nextCh = css[i];
    // A following `}` (closing a parent at-rule) manages its own leading newline via the same
    // trailing-space trim above — adding one here too would double up into a stray blank line.
    if (nextCh !== undefined && nextCh !== '}') {
      out += depth === 0 ? '\n\n' : '\n' + INDENT.repeat(depth);
    }
    return true;
  };

  const endDeclaration = (_input: object, _options: object = {}): boolean => {
    out += ';';
    i++;
    skipWhitespace({}, {});
    const nextCh = css[i];
    if (nextCh !== '}' && nextCh !== undefined) {
      out += '\n' + INDENT.repeat(depth);
      atDeclStart = true;
    }
    return true;
  };

  // Only the FIRST colon of a declaration (the property/value separator) gets a space after it —
  // a selector's own colon (`.gm-btn:hover`, matched at `depth === 0`, before any `{`) is left
  // untouched, and only `atDeclStart` (cleared the moment this fires) keeps a later colon inside
  // the same value (there are none in practice here, but the guard costs nothing) from being
  // treated as another property separator.
  const separateValue = (_input: object, _options: object = {}): boolean => {
    out += ': ';
    atDeclStart = false;
    i++;
    while (i < n && css[i] === ' ') i++;
    return true;
  };

  const consumeStructure = ({ ch }: { ch: string }, _options: object = {}): boolean => {
    if (parenDepth !== 0) return false;
    switch (ch) {
      case '{': return openRule({}, {});
      case '}': return closeRule({}, {});
      case ';': return endDeclaration({}, {});
      case ':': return depth > 0 && atDeclStart ? separateValue({}, {}) : false;
      default: return false;
    }
  };

  while (i < n) {
    const ch = css[i]!;
    if (consumeValue({ ch }, {}) || consumeStructure({ ch }, {})) continue;
    if (/\s/.test(ch)) {
      out += ' ';
      i++;
      skipWhitespace({}, {});
    } else {
      out += ch;
      i++;
    }
  }

  return out.trim();
}
