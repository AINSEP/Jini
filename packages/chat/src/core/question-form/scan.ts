/**
 * @module question-form/scan
 *
 * Markup segmentation for `<question-form>` / `<ask-question>` blocks:
 * locating open/close tags, splitting prose from form JSON, and the
 * tolerant streaming-recovery path that renders a partial form before its
 * JSON body has finished arriving. Split out of the original single-file
 * `question-form.ts`; see `../question-form.ts` for the public facade, the
 * block format, and the tag-name-alias rule.
 */
import { parsePartialJson } from '../partial-json.js';
import { parseQuotedAttrs } from '../util/markup-attributes.js';
import { asRecord, mapRawQuestion, nonEmptyString, omitUndefined, stringOrUndefined } from './normalize.js';
import type { FormQuestion, FormSegment, QuestionForm } from './types.js';

// `question-form` is the canonical tag; `ask-question` is an alias the model
// occasionally drifts to. The close tag must match the open tag name, so each
// match captures the name and computes its own close-tag string. Matching is
// case-insensitive so `<Question-Form>` / `<ASK-QUESTION>` still parse.
const OPEN_RE = /<(question-form|ask-question)\b([^>]*)>/i;

interface Block {
  start: number;
  bodyStart: number;
  /** Where the close tag starts, or `input.length` while it hasn't streamed in. */
  bodyEnd: number;
  /** Past the close tag, or `input.length` while it hasn't streamed in. */
  end: number;
  closed: boolean;
  rawAttrs: string;
}

/** The first question-form block opening at or after `from`, or `null` when there is none. */
function locateBlock({ input, from }: { input: string; from: number }): Block | null {
  const m = OPEN_RE.exec(input.slice(from));
  if (!m) return null;
  // Group 1 is a mandatory (non-optional) alternation and group 2 is an
  // unconditional `*`-quantified capture, so both always participate whenever
  // `m` itself is non-null — `noUncheckedIndexedAccess` just can't see that
  // from the regex alone.
  const closeTag = `</${m[1]!.toLowerCase()}>`;
  const start = from + m.index;
  const bodyStart = start + m[0].length;
  const closeIdx = findCloseTag(input, bodyStart, closeTag);
  const closed = closeIdx !== -1;
  return {
    start,
    bodyStart,
    bodyEnd: closed ? closeIdx : input.length,
    end: closed ? closeIdx + closeTag.length : input.length,
    closed,
    rawAttrs: m[2]!,
  };
}

/**
 * Split `input` into ordered prose/form segments. Scans repeatedly for
 * `question-form`/`ask-question` opens; for each, locates the matching close
 * tag and tries to parse the JSON body. A block that doesn't parse cleanly,
 * or has no close tag yet, is left in the prose stream verbatim.
 *
 * @complexity O(n) amortized in `input.length` — each iteration advances the
 *   cursor past the segment it just emitted.
 */
export function splitOnQuestionForms({ input }: { input: string }): FormSegment[] {
  const out: FormSegment[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const block = locateBlock({ input, from: cursor });
    if (!block?.closed) {
      // No block, or an unterminated one — leave the rest as prose so we don't swallow it.
      out.push({ kind: 'text', text: input.slice(cursor) });
      break;
    }
    if (block.start > cursor) {
      out.push({ kind: 'text', text: input.slice(cursor, block.start) });
    }
    const raw = input.slice(block.start, block.end);
    const form = tryParseForm(input.slice(block.bodyStart, block.bodyEnd), parseQuotedAttrs({ raw: block.rawAttrs }));
    // Malformed — keep raw text so the user can still see it.
    out.push(form ? { kind: 'form', form, raw } : { kind: 'text', text: raw });
    cursor = block.end;
  }
  return out;
}

/** The first complete, parseable `<question-form>` in `input`, or `null`. */
export function findFirstQuestionForm({ input }: { input: string }): { form: QuestionForm; raw: string } | null {
  for (const seg of splitOnQuestionForms({ input: input })) {
    if (seg.kind === 'form') return { form: seg.form, raw: seg.raw };
  }
  return null;
}

/**
 * Convenience wrapper over {@link findFirstQuestionForm} matching the
 * `parseQuestionForm()` name from the target API — returns just the form
 * (dropping the matched raw text), or `null` when `input` has no complete
 * question-form block. For a still-streaming block use
 * {@link parsePartialQuestionForm} instead.
 */
export function parseQuestionForm({ input }: { input: string }): QuestionForm | null {
  return findFirstQuestionForm({ input: input })?.form ?? null;
}

/**
 * Drop a trailing, not-yet-closed question-form block from streaming text so
 * a chat surface doesn't flash raw `<question-form>{…` markup before the
 * JSON finishes. Returns the visible text plus whether such an open block
 * existed (meaning a form is mid-generation).
 */
export function stripTrailingOpenQuestionForm({ input }: { input: string }): { text: string; hadOpenForm: boolean } {
  let cursor = 0;
  while (cursor < input.length) {
    const block = locateBlock({ input, from: cursor });
    if (!block) break;
    if (!block.closed) return { text: input.slice(0, block.start), hadOpenForm: true };
    cursor = block.end;
  }
  return { text: input, hadOpenForm: false };
}

/** `true` when a question-form open tag is present but its close tag hasn't streamed in yet. */
export function hasUnterminatedQuestionForm({ input }: { input: string }): boolean {
  return stripTrailingOpenQuestionForm({ input: input }).hadOpenForm;
}

function findCloseTag(input: string, from: number, closeTag: string): number {
  const closeLower = closeTag.toLowerCase();
  const tagLen = closeTag.length;
  const maxStart = input.length - tagLen;
  for (let i = from; i <= maxStart; i++) {
    if (input.slice(i, i + tagLen).toLowerCase() === closeLower) {
      return i;
    }
  }
  return -1;
}

function tryParseForm(body: string, attrs: Record<string, string>): QuestionForm | null {
  // Allow the JSON to be wrapped in a fenced ```json block — common when the
  // model echoes its own indented body.
  const stripped = body
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let data: unknown;
  try {
    data = JSON.parse(stripped);
  } catch {
    return null;
  }
  const obj = asRecord(data);
  if (!obj || !Array.isArray(obj.questions)) return null;
  const questions = obj.questions.flatMap((q: unknown, index) => mapRawQuestion({ q, index }) ?? []);
  if (questions.length === 0) return null;
  return assembleForm({ attrs, top: obj, bodyId: stringOrUndefined(obj.id), bodyTitle: stringOrUndefined(obj.title), questions });
}

// Form-level fields shared by the complete and streaming parsers: the open
// tag's attrs win over the body's own id/title, which win over the defaults.
function assembleForm({ attrs, top, bodyId, bodyTitle, questions }: {
  attrs: Record<string, string>;
  top: Record<string, unknown>;
  bodyId: string | undefined;
  bodyTitle: string | undefined;
  questions: FormQuestion[];
}): QuestionForm {
  return omitUndefined({
    id: attrs.id ?? bodyId ?? 'discovery',
    title: attrs.title ?? bodyTitle ?? 'A few quick questions',
    questions,
    description: nonEmptyString(top.description),
    submitLabel: nonEmptyString(top.submitLabel),
  });
}

/**
 * Tolerant parser for a still-streaming `<question-form>` block. Unlike
 * {@link tryParseForm} it does not require valid, complete JSON: it reads the
 * title/id from the open tag's attrs (available the instant the tag streams
 * in) and extracts however many *complete* question objects have arrived so
 * far, so a Questions panel can render a frame immediately and fill
 * questions in progressively. Returns `null` only when no open tag is
 * present at all.
 *
 * @complexity O(n) in `input.length` (one regex scan plus a linear
 *   string-aware brace walk via {@link parsePartialJson}).
 */
export function parsePartialQuestionForm({ input }: { input: string }): QuestionForm | null {
  const block = locateBlock({ input, from: 0 });
  if (!block) return null;
  const rawBody = input.slice(block.bodyStart, block.bodyEnd);
  // Strip the fenced ```json wrapper some models emit. The opening fence is
  // removed always; the trailing fence is removed too once it streams in
  // (possibly only a partial ``` so far) — otherwise leftover backticks make
  // the JSON unparseable in the gap between "fence closed" and
  // "</question-form> arrived", dropping the live preview back to empty.
  const body = stripTrailingFence(rawBody.replace(/^\s*```(?:json)?\s*/i, ''));
  // Derive form-level metadata from the *parsed top-level object*, not a
  // whole-body regex scan: a nested question/option `id`/`title`/`description`
  // must not masquerade as the form's own.
  const top = asRecord(parsePartialJson({ buf: body })) ?? {};
  const title = stringOrUndefined(top.title);
  // `id` keys a still-editable panel, so it must be stable for the whole
  // stream — don't adopt it until its string literal is fully terminated,
  // otherwise it would churn character-by-character and remount the panel.
  return assembleForm({
    attrs: parseQuotedAttrs({ raw: block.rawAttrs }),
    top,
    bodyId: completeTopLevelString(body, 'id'),
    bodyTitle: title?.trim() ? title : undefined,
    questions: shapeStreamingQuestions(top.questions, countClosedQuestionObjects(body)),
  });
}

// Strip a trailing ``` fence (possibly only partially streamed) from a form
// body — but only when those backticks are the closing wrapper, not content
// of a JSON string value still being typed.
function stripTrailingFence(body: string): string {
  const m = /(?<!\s)\s*`{1,3}\s*$/.exec(body);
  if (!m) return body;
  const before = body.slice(0, m.index);
  if (endsInsideJsonString(before)) return body;
  return before;
}

function endsInsideJsonString(s: string): boolean {
  let i = s.indexOf('"');
  while (i !== -1) {
    const end = jsonStringEnd({ s, start: i });
    if (end === -1) return true;
    i = s.indexOf('"', end);
  }
  return false;
}

// Index just past the closing quote of the JSON string literal whose opening
// quote is at `start`, or -1 when that literal hasn't finished streaming.
function jsonStringEnd({ s, start }: { s: string; start: number }): number {
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '"') return i + 1;
  }
  return -1;
}

const DEPTH_DELTA: Record<string, number> = { '{': 1, '[': 1, '}': -1, ']': -1 };

// Return a top-level (depth-1) string field's value ONLY if its string
// literal is fully terminated in the (possibly partial) body. Depth-aware so
// a nested question `id` can't be mistaken for the form's own.
function completeTopLevelString(body: string, field: string): string | undefined {
  const marker = `"${field}"`;
  let depth = 0;
  let i = 0;
  while (i < body.length) {
    const c = body[i] as string;
    if (c !== '"') {
      depth += DEPTH_DELTA[c] ?? 0;
      i += 1;
      continue;
    }
    const valueStart = depth === 1 ? keyValueStart({ body, at: i, marker }) : -1;
    if (valueStart !== -1) return readStringLiteral({ body, start: valueStart });
    // A string that isn't our key (any other key, or a value) — skip it.
    const end = jsonStringEnd({ s: body, start: i });
    if (end === -1) return undefined;
    i = end;
  }
  return undefined;
}

const KEY_COLON_RE = /\s*:\s*/y;

// Where the value starts when the string literal at `at` is the `marker` key,
// or -1 when it isn't — including a value string that merely spells the key,
// which no `:` follows.
function keyValueStart({ body, at, marker }: { body: string; at: number; marker: string }): number {
  if (!body.startsWith(marker, at)) return -1;
  KEY_COLON_RE.lastIndex = at + marker.length;
  return KEY_COLON_RE.test(body) ? KEY_COLON_RE.lastIndex : -1;
}

// The decoded string literal at `start`, or `undefined` when the value isn't
// a (started) string or its closing quote hasn't streamed yet.
function readStringLiteral({ body, start }: { body: string; start: number }): string | undefined {
  if (body[start] !== '"') return undefined; // value not a (started) string
  const end = jsonStringEnd({ s: body, start });
  if (end === -1) return undefined; // closing quote hasn't streamed yet
  const value = body.slice(start + 1, end - 1);
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function shapeStreamingQuestions(rawQuestions: unknown, closedCount: number): FormQuestion[] {
  if (!Array.isArray(rawQuestions)) return [];
  const out: FormQuestion[] = [];
  rawQuestions.forEach((raw, index) => {
    const q = asRecord(raw);
    if (!q) return;
    const label = q.label;
    if (typeof label !== 'string' || label.trim().length === 0) return;
    // Surface a question only once its canonical id is determinable, so the
    // preview id matches what the final parse assigns: a closed object's id
    // is final; an in-flight object needs an explicit id already present.
    const isClosed = index < closedCount;
    const hasId = typeof q.id === 'string' && q.id.trim().length > 0;
    if (!isClosed && !hasId) return;
    const mapped = mapRawQuestion({ q: raw, index: index });
    if (mapped) out.push(mapped);
  });
  return out;
}

// Count how many question objects in a partial `"questions": [ … ]` body
// have their closing brace already streamed (string-aware).
function countClosedQuestionObjects(body: string): number {
  const keyMatch = /"questions"\s*:\s*\[/.exec(body);
  if (!keyMatch) return 0;
  let i = keyMatch.index + keyMatch[0].length;
  let count = 0;
  for (;;) {
    while (i < body.length && /[\s,]/.test(body[i] as string)) i++;
    // Past the end, at `]`, or at a non-object element: nothing more to count.
    if (body[i] !== '{') return count;
    i = balancedObjectEnd({ s: body, start: i });
    if (i === -1) return count; // trailing object hasn't closed yet
    count++;
  }
}

// Index just past the balanced `{...}` object starting at `start`, or -1 if
// it never closes (string-aware so braces inside strings don't count).
function balancedObjectEnd({ s, start }: { s: string; start: number }): number {
  let depth = 0;
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      const end = jsonStringEnd({ s, start: i });
      if (end === -1) return -1;
      i = end;
      continue;
    }
    if (c === '{') depth += 1;
    if (c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return -1;
}
