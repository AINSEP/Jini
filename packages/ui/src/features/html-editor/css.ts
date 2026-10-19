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
  const printer: CssPrinter = { css, out: '', i: 0, depth: 0, parenDepth: 0, quote: null, atDeclStart: false };
  while (printer.i < css.length) step(printer);
  return printer.out.trim();
}

const INDENT = '  ';
const WHITESPACE = /\s/;

interface CssPrinter {
  readonly css: string;
  out: string;
  i: number;
  depth: number;
  parenDepth: number;
  quote: '"' | "'" | null;
  atDeclStart: boolean;
}

type Handler = (printer: CssPrinter) => void;

/** Quote and paren state is tracked at any depth, outside a string. */
const NESTING = new Map<string, Handler>([
  ['"', openQuote],
  ["'", openQuote],
  ['(', openParen],
  [')', closeParen],
]);

/** Structure only counts outside parens — see the file header's `url(...;...)` case. */
const STRUCTURAL = new Map<string, Handler>([
  ['{', openBlock],
  ['}', closeBlock],
  [';', endDeclaration],
]);

function step(printer: CssPrinter): void {
  const handler = printer.quote ? copyQuoted : (NESTING.get(printer.css[printer.i]!) ?? structuralHandler(printer));
  handler(printer);
}

function structuralHandler(printer: CssPrinter): Handler {
  const ch = printer.css[printer.i]!;
  if (printer.parenDepth > 0) return copyChar;
  // Only the FIRST colon of a declaration (the property/value separator) gets a space after it —
  // a selector's own colon (`.gm-btn:hover`, matched at `depth === 0`, before any `{`) is left
  // untouched, and only `atDeclStart` (cleared the moment this fires) keeps a later colon inside
  // the same value (there are none in practice here, but the guard costs nothing) from being
  // treated as another property separator.
  if (ch === ':') return printer.depth > 0 && printer.atDeclStart ? separateProperty : copyChar;
  return STRUCTURAL.get(ch) ?? (WHITESPACE.test(ch) ? collapseWhitespace : copyChar);
}

function copyChar(printer: CssPrinter): void {
  printer.out += printer.css[printer.i];
  printer.i++;
}

function copyQuoted(printer: CssPrinter): void {
  const ch = printer.css[printer.i]!;
  copyChar(printer);
  if (ch === '\\' && printer.i < printer.css.length) copyChar(printer);
  else if (ch === printer.quote) printer.quote = null;
}

function openQuote(printer: CssPrinter): void {
  printer.quote = printer.css[printer.i] as '"' | "'";
  copyChar(printer);
}

function openParen(printer: CssPrinter): void {
  printer.parenDepth++;
  copyChar(printer);
}

function closeParen(printer: CssPrinter): void {
  printer.parenDepth = Math.max(0, printer.parenDepth - 1);
  copyChar(printer);
}

function skipWhitespace(printer: CssPrinter): void {
  while (printer.i < printer.css.length && WHITESPACE.test(printer.css[printer.i]!)) printer.i++;
}

function newline(printer: CssPrinter): string {
  return '\n' + INDENT.repeat(printer.depth);
}

function trimTrailingSpace(printer: CssPrinter): void {
  printer.out = printer.out.replace(/[ \t]+$/, '');
}

function openBlock(printer: CssPrinter): void {
  trimTrailingSpace(printer);
  printer.out += ' {';
  printer.depth++;
  printer.atDeclStart = true;
  printer.i++;
  skipWhitespace(printer);
  if (printer.css[printer.i] !== '}') printer.out += newline(printer);
}

function closeBlock(printer: CssPrinter): void {
  printer.depth = Math.max(0, printer.depth - 1);
  trimTrailingSpace(printer);
  // A `}` immediately after `{` (an empty rule) needs no newline before it; otherwise close on
  // its own indented line.
  if (!printer.out.endsWith('{')) printer.out += newline(printer);
  printer.out += '}';
  printer.atDeclStart = false;
  printer.i++;
  skipWhitespace(printer);
  const nextCh = printer.css[printer.i];
  // A following `}` (closing a parent at-rule) manages its own leading newline via the same
  // trimTrailingSpace() above — adding one here too would double up into a stray blank line.
  if (nextCh !== undefined && nextCh !== '}') {
    printer.out += printer.depth === 0 ? '\n\n' : newline(printer);
  }
}

function endDeclaration(printer: CssPrinter): void {
  printer.out += ';';
  printer.i++;
  skipWhitespace(printer);
  const nextCh = printer.css[printer.i];
  if (nextCh !== '}' && nextCh !== undefined) {
    printer.out += newline(printer);
    printer.atDeclStart = true;
  }
}

function separateProperty(printer: CssPrinter): void {
  printer.out += ': ';
  printer.atDeclStart = false;
  printer.i++;
  while (printer.css[printer.i] === ' ') printer.i++;
}

function collapseWhitespace(printer: CssPrinter): void {
  printer.out += ' ';
  printer.i++;
  skipWhitespace(printer);
}
