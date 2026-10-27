/** Relative resources belong to the host. A base element is removed before delivery.
 * No request origin reaches this boundary, so absolute URLs remain conservatively external.
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

// Token boundaries keep semicolons inside comments, strings and url() out of @import termination.
// Function arguments share these boundaries so commented parentheses cannot terminate a fetch.
const IMPORT_TOKEN = /\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^"'\/;()]+|\/(?!\*)|[();]/y;

/** CSS escapes can spell url( or a scheme (\75 rl, htt\70s), so decode them before looking.
 * @complexity O(text length). */
function decodeCssEscapes({ css }: { css: string }): string {
  return css.replace(/\\(?:(\n)|([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([\s\S]))/g, (_match, _newline: string | undefined, hex: string | undefined, char: string | undefined) => {
    if (hex === undefined) return char ?? '';
    const code = parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '�';
  });
}

/** Text up to the matching close paren, honoring strings/comments; null when unreadable.
 * @complexity O(argument length) time and space. */
function functionArgument({ css, start }: { css: string; start: number }, _options = {}): string | null {
  const tokens = new RegExp(IMPORT_TOKEN);
  const parts: string[] = [];
  let index = start, depth = 1;
  while (index < css.length) {
    tokens.lastIndex = index;
    const match = tokens.exec(css);
    if (!match) return null;
    const token = match[0];
    depth += PAREN_DEPTH[token] ?? 0;
    if (depth === 0) return importText({ parts });
    parts.push(token);
    index = tokens.lastIndex;
  }
  return null;
}

/** URLs in one fetch syntax's argument. Nested url() inside image-set/@import is matched on its
 * own by the outer scan, so only strings are read here. @complexity O(argument length). */
function argumentReferences({ syntax, argument }: { syntax: string; argument: string }): string[] {
  if (syntax.toLowerCase() === 'url(') return [argument.trim().replace(/^(["'])([\s\S]*)\1$/, '$2')];
  return Array.from(argument.matchAll(CSS_STRING), string => string[1] ?? string[2]!);
}

/** Read an import prelude through its top-level semicolon or EOF. Unterminated comments,
 * strings or parentheses are unreadable, so the caller denies them. @complexity O(prelude length). */
function importArgument({ css, start }: { css: string; start: number }): string | null {
  const tokens = new RegExp(IMPORT_TOKEN);
  let index = start, depth = 0;
  const parts: string[] = [];
  while (index < css.length) {
    tokens.lastIndex = index;
    const match = tokens.exec(css);
    if (!match) return null;
    const token = match[0];
    if (token === ';' && depth === 0) return importText({ parts });
    depth += PAREN_DEPTH[token] ?? 0;
    if (depth < 0) return null;
    parts.push(token);
    index = tokens.lastIndex;
  }
  return depth === 0 ? importText({ parts }) : null;
}

/** Comments are trivia, while quoted tokens retain their contents. @complexity O(prelude length). */
function importText({ parts }: { parts: string[] }): string {
  return parts.map(part => part.startsWith('/*') ? ' ' : part).join('');
}

/** An import must name a string or a url() reference; empty/unknown preludes fail closed.
 * Nested url() is checked independently by cssReferences. @complexity O(prelude length). */
function importReferences({ argument }: { argument: string }): string[] | null {
  const references = argumentReferences({ syntax: '@import', argument });
  return references.length || /^\s*url\(/i.test(argument) ? references : null;
}

/** Every URL the CSS can fetch, or null when a fetch syntax cannot be read (treated as remote).
 * Comments are not stripped: a URL inside one is merely checked too, never hidden.
 * @complexity O(t * f) for t text length and f fetch syntaxes, each argument scanned once. */
function cssReferences({ css }: { css: string }): string[] | null {
  const references: string[] = [];
  for (const match of css.matchAll(CSS_FETCH)) {
    const start = match.index + match[0].length;
    const isImport = match[0].startsWith('@');
    const argument = isImport ? importArgument({ css, start }) : functionArgument({ css, start });
    if (argument === null) return null;
    const found = isImport ? importReferences({ argument }) : argumentReferences({ syntax: match[0], argument });
    if (found === null) return null;
    references.push(...found);
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
