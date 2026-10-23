/** A deliberately small CSS grammar: qualified rules, optionally inside width media queries.
 * Comments, strings and balanced functions are tokenized before structural punctuation is read.
 * The HTML resource scanner classifies remote URLs, not declarations/selectors; customization
 * needs this stricter grammar. Unknown CSS is rejected rather than repaired. */
export interface ConsentCssToken { kind: 'text' | 'string' | 'symbol' | 'space'; value: string; offset: number }
export interface ConsentCssDeclaration { property: string; value: string; offset: number }
export interface ConsentCssRule { selector: string; declarations: ConsentCssDeclaration[]; offset: number; media?: string }

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
  // A non-empty `closing` means this loop consumed the opener, so `cursor - 1` is a real token.
  if (closing.length) throw new ConsentCssSyntaxError('Unclosed CSS group.', tokens[state.cursor - 1]!.offset);
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
  // Only entered after the rule's `{` was consumed, so `cursor - 1` is always a real token.
  throw new ConsentCssSyntaxError('Unclosed CSS rule.', tokens[state.cursor - 1]!.offset);
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

type RuleInput = { tokens: ConsentCssToken[]; state: { cursor: number }; media?: string };

/** Read one non-nested rule; the compiler validates every selector and declaration.
 * @throws ConsentCssSyntaxError for unsupported syntax. @complexity O(consumed tokens). */
function qualifiedRule({ tokens, state, media }: RuleInput, _options = {}): ConsentCssRule {
  const offset = tokens[state.cursor]!.offset;
  const selector = takeUntil({ tokens, state, delimiters: '{};@' });
  if (!selector || tokens[state.cursor]?.value !== '{') throw new ConsentCssSyntaxError('Expected a scoped CSS rule.', offset);
  state.cursor++;
  return { selector, declarations: declarations({ tokens, state }), offset, ...(media === undefined ? {} : { media }) };
}

/** Width queries are the only supported at-rule; no imports, nested queries or feature rules.
 * @throws ConsentCssSyntaxError for unsupported queries. @complexity O(consumed tokens). */
function mediaRules({ tokens, state, media }: RuleInput, _options = {}): ConsentCssRule[] {
  const offset = tokens[state.cursor]!.offset;
  if (media !== undefined) throw new ConsentCssSyntaxError('Nested media queries are not supported.', offset);
  state.cursor++;
  const header = takeUntil({ tokens, state, delimiters: '{};@' });
  const match = /^media\s*((?:screen\s+and\s+)?\((?:min|max)-width:\s*\d{1,4}(?:\.\d+)?px\)(?:\s+and\s+\((?:min|max)-width:\s*\d{1,4}(?:\.\d+)?px\))?)$/.exec(header);
  if (!match || tokens[state.cursor]?.value !== '{') throw new ConsentCssSyntaxError('Only width @media queries are supported.', offset);
  state.cursor++;
  return ruleList({ tokens, state, media: match[1]! });
}

/** Flatten one level of media rules, preserving their conditions for safe emission.
 * @throws ConsentCssSyntaxError for unclosed/nested blocks. @complexity O(consumed tokens). */
function ruleList(input: RuleInput, _options = {}): ConsentCssRule[] {
  const { tokens, state, media } = input;
  const rules: ConsentCssRule[] = [];
  while (state.cursor < tokens.length) {
    const token = tokens[state.cursor]!;
    if (token.kind === 'space') { state.cursor++; continue; }
    if (token.value === '}' && media !== undefined) { state.cursor++; return rules; }
    if (token.value === '@') { rules.push(...mediaRules(input)); continue; }
    rules.push(qualifiedRule(input));
  }
  if (media !== undefined) throw new ConsentCssSyntaxError('Unclosed media query.', tokens[state.cursor - 1]!.offset);
  return rules;
}

/** Internal AST parser; the compiler adds size/character, selector and declaration allowlists.
 * @example parseConsentCss({ css: '@media(max-width:640px){#jini-consent{padding:12px}}' })
 * @throws ConsentCssSyntaxError for unsupported/malformed syntax. @complexity O(n) time/space. */
export function parseConsentCss({ css }: { css: string }, _options = {}): ConsentCssRule[] {
  return ruleList({ tokens: tokenize({ css }), state: { cursor: 0 } });
}
