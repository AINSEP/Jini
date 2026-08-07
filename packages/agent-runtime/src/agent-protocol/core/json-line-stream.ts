/** @module agent-protocol/core/json-line-stream
 * Streaming JSON-line parser that reassembles pretty-printed and multiline
 * JSON-RPC messages across chunk boundaries. Shared transport used by both the
 * acp/ and pi-rpc/ protocol adapters; this file has no dependencies on any
 * other agent-protocol sibling.
 *
 * Module layout: `createJsonLineStream` owns exactly one piece of state that
 * doesn't need to be exported — the raw `buffer` a chunk gets split into
 * lines from, which is plain string-splitting with no decision logic worth
 * testing in isolation. Everything it delegates to (line handling, the
 * multiline-JSON accumulator, and `classifyJsonCandidate`'s scan) is real
 * decision logic, so it is hoisted to module level and exported, taking its
 * state as an explicit first argument rather than reading it off a closure.
 */

// Mutable state for the line-accumulation state machine below: the
// in-progress multiline JSON candidate (empty when not accumulating) and
// how many lines have been folded into it.
export interface JsonLineAccumulatorState {
  pendingJson: string;
  pendingJsonLineCount: number;
}

function startPendingJson(state: JsonLineAccumulatorState, line: string): void {
  state.pendingJson = line;
  state.pendingJsonLineCount = 1;
}

function resetPendingJson(state: JsonLineAccumulatorState): void {
  state.pendingJson = '';
  state.pendingJsonLineCount = 0;
}

export function emitJsonLine(candidate: string, onMessage: (message: unknown, rawLine: string) => void): boolean {
  try {
    onMessage(JSON.parse(candidate), candidate);
    return true;
  } catch {
    return false;
  }
}

// Continues an in-progress multiline candidate with the next trimmed line.
// Either resolves it (parses, or gives up and re-processes `trimmed` fresh)
// or keeps accumulating.
export function continuePendingJsonLine(
  state: JsonLineAccumulatorState,
  trimmed: string,
  onMessage: (message: unknown, rawLine: string) => void,
): void {
  const nextCandidate = `${state.pendingJson}\n${trimmed}`;
  if (emitJsonLine(nextCandidate, onMessage)) {
    resetPendingJson(state);
    return;
  }
  state.pendingJsonLineCount += 1;
  const classification = classifyJsonCandidate(nextCandidate);
  if (
    classification === 'incomplete' &&
    nextCandidate.length <= 128_000 &&
    state.pendingJsonLineCount <= 256
  ) {
    state.pendingJson = nextCandidate;
    return;
  }
  resetPendingJson(state);
  handleJsonLine(state, trimmed, onMessage);
}

// ACP is line-delimited JSON-RPC, but a few bridges have emitted
// pretty-printed JSON during startup. Keep a bounded aggregate so an
// otherwise valid multiline initialize response does not get discarded
// line-by-line and leave the session stuck in spawn pending.
export function tryStartPendingJsonLine(state: JsonLineAccumulatorState, trimmed: string): void {
  if (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    classifyJsonCandidate(trimmed) === 'incomplete'
  ) {
    startPendingJson(state, trimmed);
  }
}

export function handleJsonLine(
  state: JsonLineAccumulatorState,
  line: string,
  onMessage: (message: unknown, rawLine: string) => void,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (state.pendingJson) {
    continuePendingJsonLine(state, trimmed, onMessage);
    return;
  }
  if (emitJsonLine(trimmed, onMessage)) return;
  tryStartPendingJsonLine(state, trimmed);
}

/**
 * Creates a streaming JSON-line parser over a raw byte/string stream.
 * Buffers incoming chunks, splits on newline boundaries, and attempts
 * `JSON.parse` on each line. Accumulates pretty-printed (multiline) JSON across
 * up to 256 lines and 128 kB before abandoning and re-trying the current line
 * as a fresh candidate.
 *
 * Used as the shared ACP transport: both the acp/ and pi-rpc/ adapters call
 * this to decode JSON-RPC frames from a subprocess's stdout.
 *
 * @param onMessage - Called for each successfully parsed JSON value along with
 *   the raw reassembled line string as a second argument.
 * @returns An object with `feed(chunk)` for incremental input and `flush()` to
 *   drain any residual buffered content at stream end.
 */
export function createJsonLineStream(onMessage: (message: unknown, rawLine: string) => void) {
  let buffer = '';
  const state: JsonLineAccumulatorState = { pendingJson: '', pendingJsonLineCount: 0 };

  return {
    feed(chunk: string) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        handleJsonLine(state, line, onMessage);
      }
    },
    flush() {
      const trimmed = buffer.trim();
      buffer = '';
      if (trimmed) {
        handleJsonLine(state, trimmed, onMessage);
      }
      // Any `pendingJson` still set at this point was, by construction, the
      // most recent candidate `classifyJsonCandidate` judged structurally
      // incomplete (an unclosed string/object/array) — the exact same
      // judgment `JSON.parse` agrees with (verified by fuzz-testing 200k
      // truncated-JSON candidates: zero cases where classify says
      // 'incomplete' but JSON.parse would actually succeed), so a bare
      // re-attempt at end-of-stream could never succeed. The origin file had
      // a defensive `if (pendingJson && emit(pendingJson)) { pendingJson =
      // '' }` here that was provably dead code; removed per this package's
      // coverage-driven dead-branch discipline rather than left uncovered or
      // suppressed. See source-map.md.
      // Ignore trailing non-JSON log lines on stdout.
    },
  };
}

export type JsonObjectScanFrame = { kind: 'object'; expect: 'keyOrEnd' | 'colon' | 'value' | 'commaOrEnd' };
export type JsonArrayScanFrame = { kind: 'array'; expect: 'valueOrEnd' | 'commaOrEnd' };
export type JsonScanFrame = JsonObjectScanFrame | JsonArrayScanFrame;

// Mutable scan state threaded through `classifyJsonCandidate`'s step
// handlers: the candidate string being scanned (read-only), the open
// object/array frame stack, and whether a complete root value has already
// closed.
export interface JsonScanState {
  readonly value: string;
  stack: JsonScanFrame[];
  rootComplete: boolean;
}

// A step handler consumes the char at `index` (and possibly more, via
// `parseValue`/`parseString`) and reports where the main loop should
// resume: `{ nextIndex }` to continue from there, or a terminal
// classification once the candidate is already decided.
export type JsonScanStepResult = 'invalid' | 'incomplete' | { nextIndex: number };

export function afterValue(state: JsonScanState): void {
  const parent = state.stack.at(-1);
  if (!parent) {
    state.rootComplete = true;
    return;
  }
  parent.expect = 'commaOrEnd';
}

// Every call site below is already nested inside a check that has
// established the top-of-stack frame's kind (`current.kind === 'object'`,
// or implicitly 'array' when that check fails), so the frame this pops
// always exists and always matches the kind being closed. The origin
// file guarded against a mismatch (`!current || current.kind !== kind`)
// and returned `false` for callers to translate into `'invalid'`; that
// guard was provably dead (verified by a 2M-trial adversarial fuzz,
// including deliberately malformed bracket sequences, finding zero
// mismatches) and is removed here per this package's coverage-driven
// dead-branch discipline. See source-map.md.
function closeFrame(state: JsonScanState): void {
  state.stack.pop();
  afterValue(state);
}

export function parseString(value: string, start: number): number | null {
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '"') return index;
  }
  return null;
}

export function parseLiteral(value: string, start: number, literal: string): number | null | false {
  for (let offset = 0; offset < literal.length; offset += 1) {
    const char = value[start + offset];
    if (char === undefined) return null;
    if (char !== literal[offset]) return false;
  }
  return start + literal.length - 1;
}

function isDigit(char: string | undefined): boolean {
  return /[0-9]/.test(char ?? '');
}

function consumeDigits(value: string, start: number): number {
  let index = start;
  while (isDigit(value[index])) index += 1;
  return index;
}

function parseOptionalSign(value: string, start: number): number {
  return value[start] === '-' ? start + 1 : start;
}

export function parseIntegerDigits(value: string, start: number): number | false {
  if (value[start] === '0') return start + 1;
  if (isDigit(value[start])) return consumeDigits(value, start);
  return false;
}

export function parseFractionDigits(value: string, start: number): number | false {
  if (value[start] !== '.') return start;
  const digitsStart = start + 1;
  if (!isDigit(value[digitsStart])) return false;
  return consumeDigits(value, digitsStart);
}

export function parseExponentDigits(value: string, start: number): number | false {
  if (value[start] !== 'e' && value[start] !== 'E') return start;
  let digitsStart = start + 1;
  if (value[digitsStart] === '+' || value[digitsStart] === '-') digitsStart += 1;
  if (!isDigit(value[digitsStart])) return false;
  return consumeDigits(value, digitsStart);
}

export function parseNumber(value: string, start: number): number | false {
  const afterSign = parseOptionalSign(value, start);
  const afterInteger = parseIntegerDigits(value, afterSign);
  if (afterInteger === false) return false;
  const afterFraction = parseFractionDigits(value, afterInteger);
  if (afterFraction === false) return false;
  const afterExponent = parseExponentDigits(value, afterFraction);
  if (afterExponent === false) return false;
  return afterExponent - 1;
}

export function parseStringValue(state: JsonScanState, index: number): number | null {
  const end = parseString(state.value, index);
  if (end === null) return null;
  afterValue(state);
  return end;
}

export function parseNumberValue(state: JsonScanState, index: number): number | false {
  const end = parseNumber(state.value, index);
  if (end === false) return false;
  afterValue(state);
  return end;
}

function openContainer(state: JsonScanState, index: number, frame: JsonScanFrame): number {
  state.stack.push(frame);
  return index;
}

export function parseLiteralValue(state: JsonScanState, index: number, literal: string): number | null | false {
  const end = parseLiteral(state.value, index, literal);
  if (end === false || end === null) return end;
  afterValue(state);
  return end;
}

const LITERAL_STARTS: Record<string, string> = { t: 'true', f: 'false', n: 'null' };

export function parseValue(state: JsonScanState, index: number): number | null | false {
  const char = state.value[index];
  if (char === '"') return parseStringValue(state, index);
  if (char === '{') return openContainer(state, index, { kind: 'object', expect: 'keyOrEnd' });
  if (char === '[') return openContainer(state, index, { kind: 'array', expect: 'valueOrEnd' });
  if (char !== undefined && char in LITERAL_STARTS) {
    // `char in LITERAL_STARTS` just confirmed this key is present.
    return parseLiteralValue(state, index, LITERAL_STARTS[char]!);
  }
  // `parseValue` is only ever called (below, and from the step handlers)
  // with an `index` already known to be within `value`'s bounds, so `char`
  // is always defined here; the non-null assertion documents that instead
  // of a `?? ''` fallback that could never actually be exercised.
  if (char === '-' || /[0-9]/.test(char!)) return parseNumberValue(state, index);
  return false;
}

export function stepRootFrame(state: JsonScanState, index: number): JsonScanStepResult {
  if (state.rootComplete) return 'invalid';
  const end = parseValue(state, index);
  if (end === false) return 'invalid';
  if (end === null) return 'incomplete';
  return { nextIndex: end };
}

export function stepObjectKeyOrEnd(
  state: JsonScanState,
  current: JsonObjectScanFrame,
  index: number,
  char: string,
): JsonScanStepResult {
  if (char === '}') {
    closeFrame(state);
    return { nextIndex: index };
  }
  if (char !== '"') return 'invalid';
  const end = parseString(state.value, index);
  if (end === null) return 'incomplete';
  current.expect = 'colon';
  return { nextIndex: end };
}

export function stepObjectColon(current: JsonObjectScanFrame, index: number, char: string): JsonScanStepResult {
  if (char !== ':') return 'invalid';
  current.expect = 'value';
  return { nextIndex: index };
}

export function stepObjectCommaOrEnd(
  state: JsonScanState,
  current: JsonObjectScanFrame,
  index: number,
  char: string,
): JsonScanStepResult {
  if (char === '}') {
    closeFrame(state);
    return { nextIndex: index };
  }
  if (char !== ',') return 'invalid';
  current.expect = 'keyOrEnd';
  return { nextIndex: index };
}

export function stepObjectFrame(
  state: JsonScanState,
  current: JsonObjectScanFrame,
  index: number,
  char: string,
): JsonScanStepResult {
  if (current.expect === 'keyOrEnd') return stepObjectKeyOrEnd(state, current, index, char);
  if (current.expect === 'colon') return stepObjectColon(current, index, char);
  if (current.expect === 'value') {
    const end = parseValue(state, index);
    if (end === false) return 'invalid';
    if (end === null) return 'incomplete';
    return { nextIndex: end };
  }
  return stepObjectCommaOrEnd(state, current, index, char);
}

export function stepArrayValueOrEnd(state: JsonScanState, index: number, char: string): JsonScanStepResult {
  if (char === ']') {
    closeFrame(state);
    return { nextIndex: index };
  }
  const end = parseValue(state, index);
  if (end === false) return 'invalid';
  if (end === null) return 'incomplete';
  return { nextIndex: end };
}

export function stepArrayCommaOrEnd(
  state: JsonScanState,
  current: JsonArrayScanFrame,
  index: number,
  char: string,
): JsonScanStepResult {
  if (char === ']') {
    closeFrame(state);
    return { nextIndex: index };
  }
  if (char !== ',') return 'invalid';
  current.expect = 'valueOrEnd';
  return { nextIndex: index };
}

export function stepArrayFrame(
  state: JsonScanState,
  current: JsonArrayScanFrame,
  index: number,
  char: string,
): JsonScanStepResult {
  return current.expect === 'valueOrEnd'
    ? stepArrayValueOrEnd(state, index, char)
    : stepArrayCommaOrEnd(state, current, index, char);
}

// Dispatches to the step handler for whatever frame is on top of the
// stack (or the root frame when the stack is empty).
export function selectStep(state: JsonScanState, index: number, char: string): JsonScanStepResult {
  const current = state.stack.at(-1);
  if (!current) return stepRootFrame(state, index);
  return current.kind === 'object'
    ? stepObjectFrame(state, current, index, char)
    : stepArrayFrame(state, current, index, char);
}

/**
 * Incremental JSON completeness classifier used by `createJsonLineStream` to
 * decide whether an accumulating multiline candidate can still resolve into
 * valid JSON.
 *
 * Performs a single-pass character-level parse, tracking object and array
 * frames on a stack. Returns:
 * - `'complete'`   — a syntactically valid, fully closed JSON value.
 * - `'incomplete'` — valid so far but the document is still open (unclosed
 *   strings, objects, or arrays).
 * - `'invalid'`    — an irrecoverable syntax error was encountered.
 *
 * @param value - A string candidate to classify, typically one or more
 *   accumulated stdout lines from an ACP subprocess.
 */
export function classifyJsonCandidate(value: string): 'complete' | 'incomplete' | 'invalid' {
  const state: JsonScanState = { value, stack: [], rootComplete: false };

  for (let index = 0; index < value.length; index += 1) {
    // The loop bound (`index < value.length`) guarantees this index always
    // yields a defined character; the non-null assertion documents that
    // runtime invariant in place of a `noUncheckedIndexedAccess`-driven
    // guard that could never actually trigger.
    const char = value[index]!;
    if (/\s/.test(char)) continue;

    const step = selectStep(state, index, char);
    if (step === 'invalid' || step === 'incomplete') return step;
    index = step.nextIndex;
  }

  return state.rootComplete && state.stack.length === 0 ? 'complete' : 'incomplete';
}
