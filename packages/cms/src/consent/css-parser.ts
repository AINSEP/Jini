/** A deliberately small CSS grammar: qualified rules containing declarations, with no nesting.
 * Comments, strings and balanced functions are tokenized before structural punctuation is read.
 * The HTML resource scanner classifies remote URLs, not declarations/selectors; customization
 * needs this stricter grammar. Unknown CSS is rejected rather than repaired. */
export interface ConsentCssToken { kind: 'text' | 'string' | 'symbol' | 'space'; value: string; offset: number }
export interface ConsentCssDeclaration { property: string; value: string; offset: number }
export interface ConsentCssRule { selector: string; declarations: ConsentCssDeclaration[]; offset: number }

export class ConsentCssSyntaxError extends Error {
  constructor(message: string, readonly offset: number) { super(message); }
}

/** Read a quoted CSS string; escape syntax is excluded by the compiler before parsing.
 * @throws ConsentCssSyntaxError for an unterminated string. @complexity O(string length). */
function quotedToken({ css, start }: { css: string; start: number }): ConsentCssToken {
  const end = css.indexOf(css[start]!, start + 1);
  if (end === -1 || /[\n\r\f]/.test(css.slice(start, end))) throw new ConsentCssSyntaxError('Unterminated CSS string.', start);
  return { kind: 'string', value: css.slice(start, end + 1), offset: start };
}

/** Read one lexical token; comment boundaries remain whitespace so identifiers never fuse.
 * @throws ConsentCssSyntaxError for unterminated comments/strings. @complexity O(token length). */
function nextToken({ css, state }: { css: string; state: { cursor: number } }): ConsentCssToken {
  const start = state.cursor;
  const char = css[start]!;
  if (css.startsWith('/*', start)) {
    const end = css.indexOf('*/', start + 2);
    if (end === -1) throw new ConsentCssSyntaxError('Unterminated CSS comment.', start);
    state.cursor = end + 2;
    return { kind: 'space', value: ' ', offset: start };
  }
  if ('"\''.includes(char)) {
    const token = quotedToken({ css, start }); state.cursor += token.value.length; return token;
  }
  state.cursor++;
  if ('{}:;(),!@[]'.includes(char)) return { kind: 'symbol', value: char, offset: start };
  if (/\s/.test(char)) return { kind: 'space', value: ' ', offset: start };
  while (state.cursor < css.length && !/[\s{}:;(),!@\[\]"']/.test(css[state.cursor]!) && !css.startsWith('/*', state.cursor)) state.cursor++;
  return { kind: 'text', value: css.slice(start, state.cursor), offset: start };
}

/** @throws ConsentCssSyntaxError for invalid tokens. @complexity O(n) time/space. */
function tokenize({ css }: { css: string }): ConsentCssToken[] {
  const tokens: ConsentCssToken[] = [];
  const state = { cursor: 0 };
  while (state.cursor < css.length) tokens.push(nextToken({ css, state }));
  return tokens;
}

/** @throws ConsentCssSyntaxError on mismatched brackets/functions. @complexity O(1). */
function trackGroup(token: ConsentCssToken, closing: string[]): void {
  if (token.kind !== 'symbol') return;
  if (token.value === '(') closing.push(')');
  if (token.value === '[') closing.push(']');
  if ([')', ']'].includes(token.value) && closing.pop() !== token.value) throw new ConsentCssSyntaxError('Unbalanced CSS group.', token.offset);
}

/** Consume structural delimiters only outside strings and balanced parentheses/brackets.
 * @throws ConsentCssSyntaxError for unbalanced groups. @complexity O(consumed tokens). */
function takeUntil({ tokens, state, delimiters }: { tokens: ConsentCssToken[]; state: { cursor: number }; delimiters: string }): string {
  const parts: string[] = [];
  const closing: string[] = [];
  while (state.cursor < tokens.length) {
    const token = tokens[state.cursor]!;
    if (token.kind === 'symbol' && !closing.length && delimiters.includes(token.value)) break;
    trackGroup(token, closing);
    parts.push(token.value); state.cursor++;
  }
  if (closing.length) throw new ConsentCssSyntaxError('Unclosed CSS group.', tokens[state.cursor - 1]?.offset ?? 0);
  return parts.join('').trim();
}

/** Parse a flat declaration list without splitting quoted/function semicolons.
 * @throws ConsentCssSyntaxError for malformed declarations. @complexity O(consumed tokens). */
function declarations({ tokens, state }: { tokens: ConsentCssToken[]; state: { cursor: number } }): ConsentCssDeclaration[] {
  const result: ConsentCssDeclaration[] = [];
  while (state.cursor < tokens.length) {
    if (tokens[state.cursor]!.kind === 'space') { state.cursor++; continue; }
    if (tokens[state.cursor]!.value === '}') { state.cursor++; return result; }
    if (tokens[state.cursor]!.value === ';') { state.cursor++; continue; }
    result.push(declaration({ tokens, state }));
  }
  throw new ConsentCssSyntaxError('Unclosed CSS rule.', tokens[state.cursor - 1]?.offset ?? 0);
}

/** @throws ConsentCssSyntaxError for malformed properties/values. @complexity O(consumed tokens). */
function declaration({ tokens, state }: { tokens: ConsentCssToken[]; state: { cursor: number } }): ConsentCssDeclaration {
  const offset = tokens[state.cursor]!.offset;
  const property = takeUntil({ tokens, state, delimiters: ':;{}' });
  if (tokens[state.cursor]?.value !== ':') throw new ConsentCssSyntaxError('Expected a CSS property followed by a colon.', offset);
  state.cursor++;
  const value = takeUntil({ tokens, state, delimiters: ';{}' });
  if (![';', '}'].includes(tokens[state.cursor]?.value ?? '')) throw new ConsentCssSyntaxError('Expected a semicolon or closing brace.', offset);
  if (tokens[state.cursor]?.value === ';') state.cursor++;
  return { property: property.toLowerCase(), value, offset };
}

/** Internal AST parser; the public compiler adds size/character and semantic allowlists.
 * At-rules and nested rules deliberately have no production in this grammar.
 * @throws ConsentCssSyntaxError for unsupported/malformed syntax. @complexity O(n) time/space. */
export function parseConsentCss({ css }: { css: string }, _options = {}): ConsentCssRule[] {
  const tokens = tokenize({ css });
  const state = { cursor: 0 };
  const rules: ConsentCssRule[] = [];
  while (state.cursor < tokens.length) {
    const offset = tokens[state.cursor]!.offset;
    const selector = takeUntil({ tokens, state, delimiters: '{};@' });
    if (!selector && state.cursor === tokens.length) break;
    if (!selector || tokens[state.cursor]?.value !== '{') throw new ConsentCssSyntaxError('Only flat scoped CSS rules are supported; at-rules are not allowed.', offset);
    state.cursor++;
    rules.push({ selector, declarations: declarations({ tokens, state }), offset });
  }
  return rules;
}
