/** Relative resources belong to the host. A base element is removed before delivery.
 * @complexity O(URL length). Unknown schemes and protocol-relative URLs are external. */
export function external({ url }: { url: string }, _options = {}): boolean {
  // Browsers normalize backslashes and embedded ASCII URL whitespace before fetching.
  const normalized = url.trim().replace(/[\t\r\n]/g, '').replace(/\\/g, '/');
  return !/^(?:[?#]|\/(?!\/)|\.?\.?\/|[a-zA-Z0-9_-]+(?:[./?#]|$))/.test(normalized) || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(normalized);
}

// Every CSS syntax that fetches: url(), src(), image-set() strings and @import strings.
const CSS_FETCH = /url\(|src\(|image-set\(|@import\b/gi;
const CSS_STRING = /"([^"]*)"|'([^']*)'/g;
const PAREN_DEPTH: Readonly<Record<string, number>> = { '(': 1, ')': -1 };

/** CSS escapes can spell url( or a scheme (\75 rl, htt\70s), so decode them before looking.
 * @complexity O(text length). */
function decodeCssEscapes({ css }: { css: string }): string {
  return css.replace(/\\(?:(\n)|([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([\s\S]))/g, (_match, _newline: string | undefined, hex: string | undefined, char: string | undefined) => {
    if (hex === undefined) return char ?? '';
    const code = parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '�';
  });
}

/** Text up to the matching close paren, honoring quotes; null when unbalanced. @complexity O(text length). */
function functionArgument({ css, start }: { css: string; start: number }): string | null {
  let depth = 1, quote = '';
  for (let index = start; index < css.length; index++) {
    const char = css[index]!;
    if (quote) { quote = char === quote ? '' : quote; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    depth += PAREN_DEPTH[char] ?? 0;
    if (depth === 0) return css.slice(start, index);
  }
  return null;
}

/** URLs in one fetch syntax's argument. Nested url() inside image-set/@import is matched on its
 * own by the outer scan, so only strings are read here. @complexity O(argument length). */
function argumentReferences({ syntax, argument }: { syntax: string; argument: string }): string[] {
  if (syntax.toLowerCase() === 'url(') return [argument.trim().replace(/^(["'])([\s\S]*)\1$/, '$2')];
  return Array.from(argument.matchAll(CSS_STRING), string => string[1] ?? string[2]!);
}

/** Every URL the CSS can fetch, or null when a fetch syntax cannot be read (treated as remote).
 * Comments are not stripped: a URL inside one is merely checked too, never hidden.
 * @complexity O(t * f) for t text length and f fetch syntaxes, each argument scanned once. */
function cssReferences({ css }: { css: string }): string[] | null {
  const references: string[] = [];
  for (const match of css.matchAll(CSS_FETCH)) {
    const start = match.index + match[0].length;
    const argument = match[0].startsWith('@') ? css.slice(start).split(';', 1)[0]! : functionArgument({ css, start });
    if (argument === null) return null;
    references.push(...argumentReferences({ syntax: match[0], argument }));
  }
  return references;
}

/** Local and data: CSS images/fonts are first-party presentation and need no consent; any remote
 * or unreadable reference does. The pre-consent resource CSP still backs this up in the browser.
 * @complexity O(t * f), see cssReferences. */
export function cssRequestsRemote({ css }: { css: string }, _options = {}): boolean {
  const references = cssReferences({ css: decodeCssEscapes({ css }) });
  return references === null || references.some(url => !/^\s*data:/i.test(url) && external({ url }));
}
