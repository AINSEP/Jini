/**
 * Minimal JS/TS comment extractor for the why-comment gate. It is not a parser: it only has to
 * tell comments apart from strings, template literals and regex literals so that `//` inside
 * `"http://x"` is not mistaken for a comment. Unterminated single-line strings and regexes
 * recover at the newline, so a stray apostrophe in JSX text cannot swallow the rest of the file.
 */

const REGEX_PREFIX_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await']);
const REGEX_PREFIX_CHARS = '(,=:[!&|?{};+-*%<>~^';
const IDENT_CHAR = /[A-Za-z0-9_$]/;

function newContext(src) {
  return { src, i: 0, line: 1, lineStart: 0, lastSig: '', word: '', templates: [], comments: [] };
}

function newline(ctx) {
  ctx.line += 1;
  ctx.i += 1;
  ctx.lineStart = ctx.i;
}

function isStandalone(ctx, start) {
  return ctx.src.slice(ctx.lineStart, start).trim() === '';
}

function readLineComment(ctx) {
  const start = ctx.i;
  const standalone = isStandalone(ctx, start);
  while (ctx.i < ctx.src.length && ctx.src[ctx.i] !== '\n') ctx.i += 1;
  ctx.comments.push({ kind: 'line', startLine: ctx.line, endLine: ctx.line, standalone, text: ctx.src.slice(start, ctx.i) });
}

function readBlockComment(ctx) {
  const start = ctx.i;
  const startLine = ctx.line;
  const standalone = isStandalone(ctx, start);
  ctx.i += 2;
  while (ctx.i < ctx.src.length && !(ctx.src[ctx.i] === '*' && ctx.src[ctx.i + 1] === '/')) {
    if (ctx.src[ctx.i] === '\n') newline(ctx);
    else ctx.i += 1;
  }
  ctx.i = Math.min(ctx.i + 2, ctx.src.length);
  ctx.comments.push({ kind: 'block', startLine, endLine: ctx.line, standalone, text: ctx.src.slice(start, ctx.i) });
}

function readQuoted(ctx) {
  const quote = ctx.src[ctx.i];
  ctx.i += 1;
  while (ctx.i < ctx.src.length) {
    const c = ctx.src[ctx.i];
    if (c === '\\') ctx.i += 2;
    else if (c === quote) { ctx.i += 1; break; }
    else if (c === '\n') break;
    else ctx.i += 1;
  }
  ctx.lastSig = '"';
}

/** Scans template text until the closing backtick or the next `${`, which hands control back to code. */
function readTemplateBody(ctx) {
  while (ctx.i < ctx.src.length) {
    const c = ctx.src[ctx.i];
    if (c === '\\') ctx.i += 2;
    else if (c === '`') { ctx.i += 1; ctx.lastSig = '"'; return; }
    else if (c === '$' && ctx.src[ctx.i + 1] === '{') { ctx.i += 2; ctx.templates.push(0); ctx.lastSig = '{'; return; }
    else if (c === '\n') newline(ctx);
    else ctx.i += 1;
  }
}

function regexAllowed(ctx) {
  if (!ctx.lastSig) return true;
  if (ctx.lastSig === 'a') return REGEX_PREFIX_WORDS.has(ctx.word);
  return REGEX_PREFIX_CHARS.includes(ctx.lastSig);
}

function readRegex(ctx) {
  ctx.i += 1;
  let inClass = false;
  while (ctx.i < ctx.src.length) {
    const c = ctx.src[ctx.i];
    if (c === '\\') ctx.i += 2;
    else if (c === '\n') break;
    else if (c === '[') { inClass = true; ctx.i += 1; }
    else if (c === ']') { inClass = false; ctx.i += 1; }
    else if (c === '/' && !inClass) { ctx.i += 1; break; }
    else ctx.i += 1;
  }
  ctx.lastSig = '"';
}

function readWord(ctx) {
  const start = ctx.i;
  while (ctx.i < ctx.src.length && IDENT_CHAR.test(ctx.src[ctx.i])) ctx.i += 1;
  ctx.word = ctx.src.slice(start, ctx.i);
  ctx.lastSig = 'a';
}

function readBrace(ctx) {
  const c = ctx.src[ctx.i];
  const top = ctx.templates.length - 1;
  ctx.i += 1;
  ctx.lastSig = c;
  if (top < 0) return;
  if (c === '{') ctx.templates[top] += 1;
  else if (ctx.templates[top] === 0) { ctx.templates.pop(); readTemplateBody(ctx); }
  else ctx.templates[top] -= 1;
}

function readSlash(ctx) {
  const next = ctx.src[ctx.i + 1];
  if (next === '/') readLineComment(ctx);
  else if (next === '*') readBlockComment(ctx);
  else if (regexAllowed(ctx)) readRegex(ctx);
  else { ctx.i += 1; ctx.lastSig = '/'; }
}

function skip(ctx) {
  ctx.i += 1;
}

function readTemplateStart(ctx) {
  ctx.i += 1;
  readTemplateBody(ctx);
}

function readOther(ctx) {
  if (IDENT_CHAR.test(ctx.src[ctx.i])) readWord(ctx);
  else { ctx.lastSig = ctx.src[ctx.i]; ctx.i += 1; }
}

const HANDLERS = {
  '\n': newline, ' ': skip, '\t': skip, '\r': skip, '/': readSlash, '"': readQuoted, "'": readQuoted, '`': readTemplateStart, '{': readBrace, '}': readBrace,
};

function step(ctx) {
  (HANDLERS[ctx.src[ctx.i]] ?? readOther)(ctx);
}

/** Joins runs of standalone `//` lines on consecutive lines into one block, as a reader sees them. */
function mergeLineRuns(comments) {
  const merged = [];
  for (const c of comments) {
    const prev = merged[merged.length - 1];
    const continues = prev && prev.kind === 'line' && c.kind === 'line' && prev.standalone && c.standalone && c.startLine === prev.endLine + 1;
    if (continues) {
      prev.endLine = c.endLine;
      prev.text += `\n${c.text}`;
    } else merged.push({ ...c });
  }
  return merged;
}

/**
 * @param {string} source
 * @returns {{kind: 'line'|'block', startLine: number, endLine: number, standalone: boolean, text: string}[]}
 */
export function extractComments(source) {
  const ctx = newContext(source);
  while (ctx.i < source.length) step(ctx);
  return mergeLineRuns(ctx.comments);
}
