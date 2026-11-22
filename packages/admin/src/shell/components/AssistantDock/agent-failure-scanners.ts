import { AGENT_FAILURE_SECRET_SHAPE_RE } from "@jini-ai/core";
/**
 * @file Linear scanners behind `redactAgentFailure`. Each one returns exactly what the regex in its
 * doc returned (verified by differential fuzzing against it), without that regex's backtracking or
 * its literal control characters. Agent stderr is untrusted text of any length, so each pass is one
 * left-to-right walk.
 */

const ESC = 0x1b;
const OSC_8BIT = 0x9d;
const CSI_8BIT = 0x9b;

/** Removes OSC strings (terminal titles, hyperlinks): `ESC ]` or 8-bit OSC, through the nearest BEL
 *  or `ESC \`. An unterminated one is kept. Same as
 *  `text.replace(/(?:\x1b\]|\x9d)[\s\S]*?(?:\x07|\x1b\\)/g, "")`. */
export function stripOscSequences({ text }: { text: string }, _options: Record<string, never> = {}): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const introLength = oscIntroLength({ text, at: i });
    if (introLength === 0) {
      out += text[i];
      i += 1;
      continue;
    }
    const end = oscEnd({ text, from: i + introLength });
    if (end === -1) return out + text.slice(i);
    i = end;
  }
  return out;
}

function oscIntroLength({ text, at }: { text: string; at: number }, _options: Record<string, never> = {}): number {
  const code = text.charCodeAt(at);
  if (code === OSC_8BIT) return 1;
  return code === ESC && text[at + 1] === "]" ? 2 : 0;
}

/** Just past the nearest BEL or `ESC \` at or after `from`; -1 when there is none. */
function oscEnd({ text, from }: { text: string; from: number }, _options: Record<string, never> = {}): number {
  const bel = text.indexOf("\u0007", from);
  const st = text.indexOf("\u001b\\", from);
  if (bel === -1 && st === -1) return -1;
  if (st === -1 || (bel !== -1 && bel < st)) return bel + 1;
  return st + 2;
}

const CSI_PREFIX_CHARS = "[]()#;?";

function isDigit({ char }: { char: string | undefined }, _options: Record<string, never> = {}): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function inRange({ char, first, last }: { char: string; first: string; last: string }, _options: Record<string, never> = {}): boolean {
  return char >= first && char <= last;
}

/** The final-byte set `[0-9A-ORZcf-nq-uy=><~]`. */
function isCsiFinal({ char }: { char: string | undefined }, _options: Record<string, never> = {}): boolean {
  if (char === undefined) return false;
  if (isDigit({ char }) || "RZcy=><~".includes(char)) return true;
  return inRange({ char, first: "A", last: "O" }) || inRange({ char, first: "f", last: "n" }) || inRange({ char, first: "q", last: "u" });
}

function digitRun({ text, from, max }: { text: string; from: number; max: number }, _options: Record<string, never> = {}): number {
  let count = 0;
  while (count < max && isDigit({ char: text[from + count] })) count += 1;
  return count;
}

/** End of `(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]` at `at`, with the regex's own
 *  backtracking: when no final byte follows the parameters, the last parameter digit becomes the
 *  final byte instead. -1 when nothing matches. */
function csiBodyEnd({ text, at }: { text: string; at: number }, _options: Record<string, never> = {}): number {
  if (!isDigit({ char: text[at] })) return isCsiFinal({ char: text[at] }) ? at + 1 : -1;
  const lead = digitRun({ text, from: at, max: 4 });
  let pos = at + lead;
  let lastFilledGroupEnd = -1;
  while (text[pos] === ";") {
    const digits = digitRun({ text, from: pos + 1, max: 4 });
    pos += 1 + digits;
    if (digits > 0) lastFilledGroupEnd = pos;
  }
  if (isCsiFinal({ char: text[pos] })) return pos + 1;
  return lastFilledGroupEnd === -1 ? at + lead : lastFilledGroupEnd;
}

/** Removes CSI sequences (colours, cursor moves). Same as
 *  `text.replace(/[\x1b\x9b][[\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~])/g, "")`. */
export function stripCsiSequences({ text }: { text: string }, _options: Record<string, never> = {}): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    const end = code === ESC || code === CSI_8BIT ? csiBodyEnd({ text, at: prefixEnd({ text, from: i + 1 }) }) : -1;
    if (end === -1) {
      out += text[i];
      i += 1;
    } else {
      i = end;
    }
  }
  return out;
}

function prefixEnd({ text, from }: { text: string; from: number }, _options: Record<string, never> = {}): number {
  let end = from;
  while (end < text.length && CSI_PREFIX_CHARS.includes(text.charAt(end))) end += 1;
  return end;
}

/** Tab, LF and CR: the control characters that survive. */
const KEPT_CONTROL_CODES: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d]);

/** Removes C0/C1 control characters except tab, LF and CR. Same as
 *  `text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "")`. */
export function stripControlCharacters({ text }: { text: string }, _options: Record<string, never> = {}): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    const printable = (code > 0x1f && code < 0x7f) || code > 0x9f;
    const kept = printable || KEPT_CONTROL_CODES.has(code);
    if (kept) out += char;
  }
  return out;
}

const WORD_CHAR = /\w/;
/** Provider credential shapes, tried in this order at each word start — the order of the
 *  alternation they replace, so the first shape that fits wins exactly as it did there. */
// Jini owns the vocabulary and alternative order; sticky matching preserves this scanner's walk.
const TOKEN_SHAPE = new RegExp(AGENT_FAILURE_SECRET_SHAPE_RE.source, "y");

function stickyEnd({ pattern, text, at }: { pattern: RegExp; text: string; at: number }, _options: Record<string, never> = {}): number {
  pattern.lastIndex = at;
  return pattern.test(text) ? pattern.lastIndex : -1;
}

/** Replaces provider-shaped credentials (Google, GitHub, OpenAI-style, JWTs) that start a word with
 *  `[REDACTED]`. Same as `text.replace(/\b(?:AIza[\w-]+|…|eyJ…)/g, "[REDACTED]")`. */
export function redactCredentialShapes({ text }: { text: string }, _options: Record<string, never> = {}): string {
  let out = "";
  let copied = 0;
  let i = 0;
  while (i < text.length) {
    const end = i > 0 && WORD_CHAR.test(text.charAt(i - 1)) ? -1 : stickyEnd({ pattern: TOKEN_SHAPE, text, at: i });
    if (end === -1) {
      i += 1;
    } else {
      out += `${text.slice(copied, i)}[REDACTED]`;
      copied = end;
      i = end;
    }
  }
  return out + text.slice(copied);
}

const SECRET_NAME = /(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|secret|password)/iy;
const BARE_TOKEN_NAME = /token/iy;
const ASSIGNMENT = /["']?\s*[:=]\s*["']?/y;
const ASSIGNED_VALUE = /[^\s"'&,;}]+/y;
const NAME_CHAR = /[\w-]/;

interface ValueSpan { readonly start: number; readonly end: number }

/** The value assigned right after a `name` pattern match at `at`, or null. */
function assignedValueAfter({ name, text, at }: { name: RegExp; text: string; at: number }, _options: Record<string, never> = {}): ValueSpan | null {
  const nameEnd = stickyEnd({ pattern: name, text, at });
  const start = nameEnd === -1 ? -1 : stickyEnd({ pattern: ASSIGNMENT, text, at: nameEnd });
  const end = start === -1 ? -1 : stickyEnd({ pattern: ASSIGNED_VALUE, text, at: start });
  return end === -1 ? null : { start, end };
}

function nameRunEnd({ text, from }: { text: string; from: number }, _options: Record<string, never> = {}): number {
  let end = from;
  while (end < text.length && NAME_CHAR.test(text.charAt(end))) end += 1;
  return end;
}

/** The value a name starting in `[start, runEnd)` assigns: the rightmost secret-ish name wins (the
 *  replaced regex's greedy `[\w-]*` prefix), else a bare `token` name at the earliest position. */
function secretAssignmentIn({ text, start, runEnd }: { text: string; start: number; runEnd: number }, _options: Record<string, never> = {}): ValueSpan | null {
  for (let at = runEnd - 1; at >= start; at -= 1) {
    const span = assignedValueAfter({ name: SECRET_NAME, text, at });
    if (span) return span;
  }
  for (let at = start; at < runEnd; at += 1) {
    const span = assignedValueAfter({ name: BARE_TOKEN_NAME, text, at });
    if (span) return span;
  }
  return null;
}

/** Replaces the value of `apiKey=…`, `"access_token": "…"`, `password: …`-style assignments with
 *  `[REDACTED]`, keeping the name. Same as
 *  `text.replace(/((?:[\w-]*(?:api[ _-]?key|…|password)|token)["']?\s*[:=]\s*["']?)([^\s"'&,;}]+)/gi, "$1[REDACTED]")`. */
export function redactSecretAssignments({ text }: { text: string }, _options: Record<string, never> = {}): string {
  let out = "";
  let copied = 0;
  let i = 0;
  while (i < text.length) {
    const runEnd = nameRunEnd({ text, from: i });
    const span = runEnd === i ? null : secretAssignmentIn({ text, start: i, runEnd });
    if (span) {
      out += `${text.slice(copied, span.start)}[REDACTED]`;
      copied = span.end;
      i = span.end;
    } else {
      i = Math.max(runEnd, i + 1);
    }
  }
  return out + text.slice(copied);
}
