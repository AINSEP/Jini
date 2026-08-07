import { describe, expect, it, vi } from 'vitest';
import {
  afterValue,
  classifyJsonCandidate,
  continuePendingJsonLine,
  createJsonLineStream,
  emitJsonLine,
  handleJsonLine,
  parseExponentDigits,
  parseFractionDigits,
  parseIntegerDigits,
  parseLiteral,
  parseLiteralValue,
  parseNumber,
  parseNumberValue,
  parseString,
  parseStringValue,
  parseValue,
  selectStep,
  stepArrayCommaOrEnd,
  stepArrayFrame,
  stepArrayValueOrEnd,
  stepObjectColon,
  stepObjectCommaOrEnd,
  stepObjectFrame,
  stepObjectKeyOrEnd,
  stepRootFrame,
  tryStartPendingJsonLine,
  type JsonArrayScanFrame,
  type JsonLineAccumulatorState,
  type JsonObjectScanFrame,
  type JsonScanState,
} from '../json-line-stream.js';

// Fresh state builders matching each exported step-handler's expected shape.
function scanState(overrides: Partial<JsonScanState> = {}): JsonScanState {
  return { value: '', stack: [], rootComplete: false, ...overrides };
}

function objectFrame(expect: JsonObjectScanFrame['expect'] = 'keyOrEnd'): JsonObjectScanFrame {
  return { kind: 'object', expect };
}

function arrayFrame(expect: JsonArrayScanFrame['expect'] = 'valueOrEnd'): JsonArrayScanFrame {
  return { kind: 'array', expect };
}

function accumulatorState(overrides: Partial<JsonLineAccumulatorState> = {}): JsonLineAccumulatorState {
  return { pendingJson: '', pendingJsonLineCount: 0, ...overrides };
}

describe('classifyJsonCandidate', () => {
  it('classifies a complete object as complete', () => {
    expect(classifyJsonCandidate('{"a":1}')).toBe('complete');
  });

  it('classifies a complete array as complete', () => {
    expect(classifyJsonCandidate('[1,2,3]')).toBe('complete');
  });

  it('classifies an empty object and empty array as complete', () => {
    expect(classifyJsonCandidate('{}')).toBe('complete');
    expect(classifyJsonCandidate('[]')).toBe('complete');
  });

  it('classifies an empty array immediately followed by more input as invalid', () => {
    expect(classifyJsonCandidate('[][]')).toBe('invalid');
  });

  it('classifies scalars as complete', () => {
    expect(classifyJsonCandidate('true')).toBe('complete');
    expect(classifyJsonCandidate('false')).toBe('complete');
    expect(classifyJsonCandidate('null')).toBe('complete');
    expect(classifyJsonCandidate('42')).toBe('complete');
    expect(classifyJsonCandidate('-42')).toBe('complete');
    expect(classifyJsonCandidate('0')).toBe('complete');
    expect(classifyJsonCandidate('3.14')).toBe('complete');
    expect(classifyJsonCandidate('1e10')).toBe('complete');
    expect(classifyJsonCandidate('1.5e+10')).toBe('complete');
    expect(classifyJsonCandidate('1e-10')).toBe('complete');
    expect(classifyJsonCandidate('"hello"')).toBe('complete');
  });

  it('classifies an unclosed object as incomplete', () => {
    expect(classifyJsonCandidate('{"a":1')).toBe('incomplete');
    expect(classifyJsonCandidate('{"a"')).toBe('incomplete');
    expect(classifyJsonCandidate('{"a":')).toBe('incomplete');
    expect(classifyJsonCandidate('{')).toBe('incomplete');
  });

  it('classifies an unclosed array as incomplete', () => {
    expect(classifyJsonCandidate('[1,2')).toBe('incomplete');
    expect(classifyJsonCandidate('[')).toBe('incomplete');
  });

  it('classifies an unclosed string as incomplete', () => {
    expect(classifyJsonCandidate('"hello')).toBe('incomplete');
  });

  it('classifies an unclosed object key string as incomplete', () => {
    expect(classifyJsonCandidate('{"a')).toBe('incomplete');
  });

  it('classifies an unclosed object value string as incomplete', () => {
    expect(classifyJsonCandidate('{"a":"b')).toBe('incomplete');
  });

  it('classifies an unclosed array value string as incomplete', () => {
    expect(classifyJsonCandidate('["a')).toBe('incomplete');
  });

  it('classifies a lone minus sign with nothing after it as invalid', () => {
    expect(classifyJsonCandidate('-')).toBe('invalid');
  });

  it('classifies a partial literal as incomplete', () => {
    expect(classifyJsonCandidate('tru')).toBe('incomplete');
    expect(classifyJsonCandidate('fals')).toBe('incomplete');
    expect(classifyJsonCandidate('nul')).toBe('incomplete');
  });

  it('classifies a number cut off mid-fraction/exponent (no trailing digit) as invalid', () => {
    // The classifier requires at least one digit after `.`/`e`/`e+`; a
    // candidate that ends exactly there has no way to resolve into valid
    // JSON by appending more digits at the *next* line boundary (the parser
    // re-tries char-by-char within the same candidate), so it is invalid
    // rather than incomplete.
    expect(classifyJsonCandidate('1.')).toBe('invalid');
    expect(classifyJsonCandidate('1e')).toBe('invalid');
    expect(classifyJsonCandidate('1e+')).toBe('invalid');
  });

  it('classifies a number with more digits pending as incomplete', () => {
    expect(classifyJsonCandidate('123')).toBe('complete');
    expect(classifyJsonCandidate('[123')).toBe('incomplete');
  });

  it('classifies malformed literals as invalid', () => {
    expect(classifyJsonCandidate('trux')).toBe('invalid');
    expect(classifyJsonCandidate('falsx')).toBe('invalid');
    expect(classifyJsonCandidate('nulx')).toBe('invalid');
  });

  it('classifies a bad number as invalid', () => {
    expect(classifyJsonCandidate('-x')).toBe('invalid');
    expect(classifyJsonCandidate('1.x')).toBe('invalid');
    expect(classifyJsonCandidate('1ex')).toBe('invalid');
  });

  it('classifies a stray closing brace/bracket as invalid', () => {
    expect(classifyJsonCandidate('}')).toBe('invalid');
    expect(classifyJsonCandidate(']')).toBe('invalid');
    expect(classifyJsonCandidate('{]')).toBe('invalid');
    expect(classifyJsonCandidate('[}')).toBe('invalid');
  });

  it('classifies an object missing a colon as invalid', () => {
    expect(classifyJsonCandidate('{"a" 1}')).toBe('invalid');
  });

  it('classifies an object with a bad key as invalid', () => {
    expect(classifyJsonCandidate('{1:2}')).toBe('invalid');
  });

  it('classifies an object with a bad separator as invalid', () => {
    expect(classifyJsonCandidate('{"a":1 "b":2}')).toBe('invalid');
  });

  it('classifies an array with a bad separator as invalid', () => {
    expect(classifyJsonCandidate('[1 2]')).toBe('invalid');
  });

  it('classifies extra content after a complete root value as invalid', () => {
    expect(classifyJsonCandidate('{}{}')).toBe('invalid');
  });

  it('classifies a bad value token as invalid', () => {
    expect(classifyJsonCandidate('{"a":x}')).toBe('invalid');
    expect(classifyJsonCandidate('[x]')).toBe('invalid');
  });

  it('classifies whitespace-only input as incomplete', () => {
    expect(classifyJsonCandidate('   ')).toBe('incomplete');
    expect(classifyJsonCandidate('')).toBe('incomplete');
  });

  it('handles nested structures with whitespace', () => {
    expect(classifyJsonCandidate('{ "a" : [ 1 , 2 , { "b" : true } ] }')).toBe('complete');
  });

  it('handles escaped characters within strings', () => {
    expect(classifyJsonCandidate(String.raw`{"a":"he said \"hi\""}`)).toBe('complete');
    // A trailing backslash inside an unterminated string: the escape
    // consumes the next character (here, none is left), so the string
    // never finds its closing quote — incomplete, not invalid.
    expect(classifyJsonCandidate('"a' + String.fromCharCode(92))).toBe('incomplete');
  });
});

describe('createJsonLineStream', () => {
  it('parses a single complete JSON line', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    stream.feed('{"a":1}\n');
    expect(messages).toEqual([{ a: 1 }]);
  });

  it('parses multiple lines fed in one chunk', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    stream.feed('{"a":1}\n{"b":2}\n');
    expect(messages).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('buffers a partial line across feed() calls', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    stream.feed('{"a":');
    expect(messages).toEqual([]);
    stream.feed('1}\n');
    expect(messages).toEqual([{ a: 1 }]);
  });

  it('splits a chunk containing multiple lines and a trailing partial line', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    stream.feed('{"a":1}\n{"b":2}\n{"c":');
    expect(messages).toEqual([{ a: 1 }, { b: 2 }]);
    stream.feed('3}\n');
    expect(messages).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('ignores blank lines', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    stream.feed('\n\n{"a":1}\n\n');
    expect(messages).toEqual([{ a: 1 }]);
  });

  it('flush() drains a residual buffered line with no trailing newline', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    stream.feed('{"a":1}');
    expect(messages).toEqual([]);
    stream.flush();
    expect(messages).toEqual([{ a: 1 }]);
  });

  it('flush() on an empty buffer is a no-op', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    expect(() => stream.flush()).not.toThrow();
    expect(messages).toEqual([]);
  });

  it('ignores a non-JSON trailing log line on flush', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    stream.feed('not json at all');
    stream.flush();
    expect(messages).toEqual([]);
  });

  it('passes the raw reassembled line as the second callback argument', () => {
    const raws: string[] = [];
    const stream = createJsonLineStream((_msg, raw) => raws.push(raw));
    stream.feed('{"a":1}\n');
    expect(raws).toEqual(['{"a":1}']);
  });

  it('reassembles a pretty-printed multiline JSON object', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    stream.feed('{\n');
    stream.feed('  "a": 1,\n');
    stream.feed('  "b": 2\n');
    stream.feed('}\n');
    expect(messages).toEqual([{ a: 1, b: 2 }]);
  });

  it('reassembles a pretty-printed multiline JSON object whose final line has no trailing newline, via flush()', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    // No trailing newline after the closing brace, so it stays buffered
    // until flush() drains it.
    stream.feed('{\n  "a": 1\n}');
    stream.flush();
    expect(messages).toEqual([{ a: 1 }]);
  });

  it('abandons a multiline candidate that exceeds 256 lines and retries the current line fresh', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    // Open an object that never legally closes within the line budget.
    stream.feed('{\n');
    for (let i = 0; i < 260; i += 1) {
      stream.feed(`"k${i}": ${i},\n`);
    }
    // A fresh valid line should still parse after the pending candidate is abandoned.
    stream.feed('{"fresh":true}\n');
    expect(messages).toContainEqual({ fresh: true });
  });

  it('abandons a multiline candidate that exceeds the byte budget and retries the current line fresh', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    stream.feed('{\n');
    // A single huge line pushes the candidate over 128_000 chars immediately.
    const hugeLine = `"pad": "${'x'.repeat(129_000)}"\n`;
    stream.feed(hugeLine);
    stream.feed('{"fresh":true}\n');
    expect(messages).toContainEqual({ fresh: true });
  });

  it('starts a pending multiline candidate only for lines beginning with { or [', () => {
    const messages: unknown[] = [];
    const raws: string[] = [];
    const stream = createJsonLineStream((msg, raw) => {
      messages.push(msg);
      raws.push(raw);
    });
    // Not JSON and doesn't start with { or [ -> should be silently dropped,
    // not accumulated into a pending candidate.
    stream.feed('hello world\n');
    stream.feed('{"a":1}\n');
    expect(messages).toEqual([{ a: 1 }]);
  });

  it('treats a line starting with { that is already invalid (not just incomplete) as a dropped line', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    // `{]` is invalid, not incomplete, so it must not start a pending candidate.
    stream.feed('{]\n');
    stream.feed('{"a":1}\n');
    expect(messages).toEqual([{ a: 1 }]);
  });

  it('recovers when a pending multiline candidate resolves to invalid JSON on the next line and the next line parses standalone', () => {
    const messages: unknown[] = [];
    const stream = createJsonLineStream((msg) => messages.push(msg));
    stream.feed('{\n');
    // Appending this makes the candidate `{\nbad line here` which is invalid
    // (starts a value with 'b'), forcing handleLine to retry the current
    // line fresh.
    stream.feed('bad line here\n');
    stream.feed('{"a":1}\n');
    expect(messages).toEqual([{ a: 1 }]);
  });
});

// The remaining describe blocks unit-test the exported decision logic
// `createJsonLineStream`/`classifyJsonCandidate` are built from, in
// isolation from the streaming wrapper. These are *in addition to* the
// end-to-end tests above, not a replacement — a green unit test on a step
// handler proves that handler's own branches are correct, not that the
// whole pipeline still behaves the same.

describe('parseString', () => {
  it('returns the index of the closing quote', () => {
    expect(parseString('"ab"', 0)).toBe(3);
  });

  it('skips an escaped character, including an escaped quote', () => {
    expect(parseString(String.raw`"a\"b"`, 0)).toBe(5);
  });

  it('returns null for a string with no closing quote', () => {
    expect(parseString('"abc', 0)).toBeNull();
  });

  it('returns null when a trailing backslash consumes the last character', () => {
    expect(parseString('"a' + String.fromCharCode(92), 0)).toBeNull();
  });
});

describe('parseLiteral', () => {
  it('returns the index of the last matched character on a full match', () => {
    expect(parseLiteral('true', 0, 'true')).toBe(3);
  });

  it('returns false when a character mismatches the literal', () => {
    expect(parseLiteral('trux', 0, 'true')).toBe(false);
  });

  it('returns null when the input ends before the literal completes', () => {
    expect(parseLiteral('tru', 0, 'true')).toBeNull();
  });

  it('matches a literal starting mid-string', () => {
    expect(parseLiteral('xxfalse', 2, 'false')).toBe(6);
  });
});

describe('parseIntegerDigits', () => {
  it('consumes a lone leading zero without reading further digits', () => {
    expect(parseIntegerDigits('01', 0)).toBe(1);
  });

  it('consumes a multi-digit run starting with 1-9', () => {
    expect(parseIntegerDigits('123abc', 0)).toBe(3);
  });

  it('returns false when there is no digit at start', () => {
    expect(parseIntegerDigits('abc', 0)).toBe(false);
  });
});

describe('parseFractionDigits', () => {
  it('returns start unchanged when there is no dot', () => {
    expect(parseFractionDigits('123', 3)).toBe(3);
  });

  it('consumes digits after the dot', () => {
    expect(parseFractionDigits('.45x', 0)).toBe(3);
  });

  it('returns false when the dot has no following digit', () => {
    expect(parseFractionDigits('.x', 0)).toBe(false);
  });
});

describe('parseExponentDigits', () => {
  it('returns start unchanged when there is no e/E', () => {
    expect(parseExponentDigits('123', 3)).toBe(3);
  });

  it('consumes digits after a bare e', () => {
    expect(parseExponentDigits('e10x', 0)).toBe(3);
  });

  it('consumes digits after e+ and e-', () => {
    expect(parseExponentDigits('e+10x', 0)).toBe(4);
    expect(parseExponentDigits('e-10x', 0)).toBe(4);
  });

  it('accepts an uppercase E', () => {
    expect(parseExponentDigits('E5x', 0)).toBe(2);
  });

  it('returns false when e has no following digit', () => {
    expect(parseExponentDigits('ex', 0)).toBe(false);
  });

  it('returns false when e+ has no following digit', () => {
    expect(parseExponentDigits('e+x', 0)).toBe(false);
  });
});

describe('parseNumber', () => {
  it('parses a plain integer', () => {
    expect(parseNumber('123', 0)).toBe(2);
  });

  it('parses a negative integer', () => {
    expect(parseNumber('-123', 0)).toBe(3);
  });

  it('parses a decimal', () => {
    expect(parseNumber('3.14', 0)).toBe(3);
  });

  it('parses a number with an exponent', () => {
    expect(parseNumber('1.5e+10', 0)).toBe(6);
  });

  it('returns false for a lone minus sign', () => {
    expect(parseNumber('-', 0)).toBe(false);
  });

  it('returns false for an invalid fraction part', () => {
    expect(parseNumber('1.', 0)).toBe(false);
  });

  it('returns false for an invalid exponent part', () => {
    expect(parseNumber('1e', 0)).toBe(false);
  });
});

describe('afterValue', () => {
  it('marks the scan root complete when the frame stack is empty', () => {
    const state = scanState();
    afterValue(state);
    expect(state.rootComplete).toBe(true);
  });

  it('advances the top-of-stack frame to commaOrEnd instead of touching rootComplete', () => {
    const frame = objectFrame('value');
    const state = scanState({ stack: [frame] });
    afterValue(state);
    expect(frame.expect).toBe('commaOrEnd');
    expect(state.rootComplete).toBe(false);
  });
});

describe('parseStringValue', () => {
  it('returns null and leaves the scan incomplete for an unterminated string', () => {
    const state = scanState({ value: '"abc' });
    expect(parseStringValue(state, 0)).toBeNull();
    expect(state.rootComplete).toBe(false);
  });

  it('returns the end index and marks the root complete for a closed string', () => {
    const state = scanState({ value: '"abc"' });
    expect(parseStringValue(state, 0)).toBe(4);
    expect(state.rootComplete).toBe(true);
  });
});

describe('parseNumberValue', () => {
  it('returns false for an invalid number without mutating scan state', () => {
    const state = scanState({ value: '-' });
    expect(parseNumberValue(state, 0)).toBe(false);
    expect(state.rootComplete).toBe(false);
  });

  it('returns the end index and marks the root complete for a valid number', () => {
    const state = scanState({ value: '42' });
    expect(parseNumberValue(state, 0)).toBe(1);
    expect(state.rootComplete).toBe(true);
  });
});

describe('parseLiteralValue', () => {
  it('returns null for a truncated literal without mutating scan state', () => {
    const state = scanState({ value: 'tru' });
    expect(parseLiteralValue(state, 0, 'true')).toBeNull();
    expect(state.rootComplete).toBe(false);
  });

  it('returns false for a mismatched literal', () => {
    const state = scanState({ value: 'trux' });
    expect(parseLiteralValue(state, 0, 'true')).toBe(false);
  });

  it('returns the end index and marks the root complete for a full match', () => {
    const state = scanState({ value: 'null' });
    expect(parseLiteralValue(state, 0, 'null')).toBe(3);
    expect(state.rootComplete).toBe(true);
  });
});

describe('parseValue', () => {
  it('dispatches to string parsing for a `"`', () => {
    const state = scanState({ value: '"a"' });
    expect(parseValue(state, 0)).toBe(2);
  });

  it('opens an object frame for `{` without consuming further input', () => {
    const state = scanState({ value: '{' });
    expect(parseValue(state, 0)).toBe(0);
    expect(state.stack).toEqual([{ kind: 'object', expect: 'keyOrEnd' }]);
  });

  it('opens an array frame for `[` without consuming further input', () => {
    const state = scanState({ value: '[' });
    expect(parseValue(state, 0)).toBe(0);
    expect(state.stack).toEqual([{ kind: 'array', expect: 'valueOrEnd' }]);
  });

  it('dispatches to literal parsing for t/f/n', () => {
    expect(parseValue(scanState({ value: 'true' }), 0)).toBe(3);
    expect(parseValue(scanState({ value: 'false' }), 0)).toBe(4);
    expect(parseValue(scanState({ value: 'null' }), 0)).toBe(3);
  });

  it('dispatches to number parsing for a digit or a leading minus', () => {
    expect(parseValue(scanState({ value: '42' }), 0)).toBe(1);
    expect(parseValue(scanState({ value: '-42' }), 0)).toBe(2);
  });

  it('returns false for an unrecognized character', () => {
    expect(parseValue(scanState({ value: 'x' }), 0)).toBe(false);
  });
});

describe('stepRootFrame', () => {
  it('returns invalid once the root value has already completed', () => {
    const state = scanState({ value: '{}{}', rootComplete: true });
    expect(stepRootFrame(state, 2)).toBe('invalid');
  });

  it('returns incomplete for a truncated root value', () => {
    const state = scanState({ value: '"abc' });
    expect(stepRootFrame(state, 0)).toBe('incomplete');
  });

  it('returns invalid for a malformed root value', () => {
    const state = scanState({ value: 'x' });
    expect(stepRootFrame(state, 0)).toBe('invalid');
  });

  it('returns the next index for a valid root value', () => {
    const state = scanState({ value: '42' });
    expect(stepRootFrame(state, 0)).toEqual({ nextIndex: 1 });
  });
});

describe('stepObjectKeyOrEnd', () => {
  it('closes the frame on `}`', () => {
    const frame = objectFrame('keyOrEnd');
    const state = scanState({ value: '{}', stack: [frame] });
    expect(stepObjectKeyOrEnd(state, frame, 1, '}')).toEqual({ nextIndex: 1 });
    expect(state.stack).toEqual([]);
  });

  it('returns invalid when the next char is not a quote', () => {
    const frame = objectFrame('keyOrEnd');
    const state = scanState({ value: '{1', stack: [frame] });
    expect(stepObjectKeyOrEnd(state, frame, 1, '1')).toBe('invalid');
  });

  it('returns incomplete for an unterminated key string', () => {
    const frame = objectFrame('keyOrEnd');
    const state = scanState({ value: '{"a', stack: [frame] });
    expect(stepObjectKeyOrEnd(state, frame, 1, '"')).toBe('incomplete');
  });

  it('advances expect to colon and returns the key string end index', () => {
    const frame = objectFrame('keyOrEnd');
    const state = scanState({ value: '{"a"', stack: [frame] });
    expect(stepObjectKeyOrEnd(state, frame, 1, '"')).toEqual({ nextIndex: 3 });
    expect(frame.expect).toBe('colon');
  });
});

describe('stepObjectColon', () => {
  it('returns invalid when the char is not a colon', () => {
    const frame = objectFrame('colon');
    expect(stepObjectColon(frame, 4, 'x')).toBe('invalid');
  });

  it('advances expect to value on a colon', () => {
    const frame = objectFrame('colon');
    expect(stepObjectColon(frame, 4, ':')).toEqual({ nextIndex: 4 });
    expect(frame.expect).toBe('value');
  });
});

describe('stepObjectCommaOrEnd', () => {
  it('closes the frame on `}`', () => {
    const frame = objectFrame('commaOrEnd');
    const state = scanState({ stack: [frame] });
    expect(stepObjectCommaOrEnd(state, frame, 5, '}')).toEqual({ nextIndex: 5 });
    expect(state.stack).toEqual([]);
  });

  it('returns invalid when the char is neither `,` nor `}`', () => {
    const frame = objectFrame('commaOrEnd');
    const state = scanState({ stack: [frame] });
    expect(stepObjectCommaOrEnd(state, frame, 5, 'x')).toBe('invalid');
  });

  it('advances expect to keyOrEnd on a comma', () => {
    const frame = objectFrame('commaOrEnd');
    const state = scanState({ stack: [frame] });
    expect(stepObjectCommaOrEnd(state, frame, 5, ',')).toEqual({ nextIndex: 5 });
    expect(frame.expect).toBe('keyOrEnd');
  });
});

describe('stepObjectFrame', () => {
  it('delegates to the keyOrEnd handler', () => {
    const frame = objectFrame('keyOrEnd');
    const state = scanState({ value: '{}', stack: [frame] });
    expect(stepObjectFrame(state, frame, 1, '}')).toEqual({ nextIndex: 1 });
  });

  it('delegates to the colon handler', () => {
    const frame = objectFrame('colon');
    const state = scanState({ stack: [frame] });
    expect(stepObjectFrame(state, frame, 4, ':')).toEqual({ nextIndex: 4 });
  });

  it('parses a value directly in the value state', () => {
    const frame = objectFrame('value');
    const state = scanState({ value: '{"a":1}', stack: [frame] });
    expect(stepObjectFrame(state, frame, 5, '1')).toEqual({ nextIndex: 5 });
  });

  it('returns invalid for a malformed value in the value state', () => {
    const frame = objectFrame('value');
    const state = scanState({ value: '{"a":x}', stack: [frame] });
    expect(stepObjectFrame(state, frame, 5, 'x')).toBe('invalid');
  });

  it('returns incomplete for a truncated value in the value state', () => {
    const frame = objectFrame('value');
    const state = scanState({ value: '{"a":"b', stack: [frame] });
    expect(stepObjectFrame(state, frame, 5, '"')).toBe('incomplete');
  });

  it('delegates to the commaOrEnd handler', () => {
    const frame = objectFrame('commaOrEnd');
    const state = scanState({ stack: [frame] });
    expect(stepObjectFrame(state, frame, 5, ',')).toEqual({ nextIndex: 5 });
  });
});

describe('stepArrayValueOrEnd', () => {
  it('closes the frame on `]`', () => {
    const frame = arrayFrame('valueOrEnd');
    const state = scanState({ stack: [frame] });
    expect(stepArrayValueOrEnd(state, 1, ']')).toEqual({ nextIndex: 1 });
    expect(state.stack).toEqual([]);
  });

  it('returns invalid for a malformed value', () => {
    const state = scanState({ value: '[x]' });
    expect(stepArrayValueOrEnd(state, 1, 'x')).toBe('invalid');
  });

  it('returns incomplete for a truncated value', () => {
    const state = scanState({ value: '["a' });
    expect(stepArrayValueOrEnd(state, 1, '"')).toBe('incomplete');
  });

  it('returns the next index for a valid value', () => {
    const state = scanState({ value: '[1]' });
    expect(stepArrayValueOrEnd(state, 1, '1')).toEqual({ nextIndex: 1 });
  });
});

describe('stepArrayCommaOrEnd', () => {
  it('closes the frame on `]`', () => {
    const frame = arrayFrame('commaOrEnd');
    const state = scanState({ stack: [frame] });
    expect(stepArrayCommaOrEnd(state, frame, 2, ']')).toEqual({ nextIndex: 2 });
    expect(state.stack).toEqual([]);
  });

  it('returns invalid when the char is neither `,` nor `]`', () => {
    const frame = arrayFrame('commaOrEnd');
    const state = scanState({ stack: [frame] });
    expect(stepArrayCommaOrEnd(state, frame, 2, 'x')).toBe('invalid');
  });

  it('advances expect to valueOrEnd on a comma', () => {
    const frame = arrayFrame('commaOrEnd');
    const state = scanState({ stack: [frame] });
    expect(stepArrayCommaOrEnd(state, frame, 2, ',')).toEqual({ nextIndex: 2 });
    expect(frame.expect).toBe('valueOrEnd');
  });
});

describe('stepArrayFrame', () => {
  it('delegates to the valueOrEnd handler', () => {
    const frame = arrayFrame('valueOrEnd');
    const state = scanState({ value: '[1]', stack: [frame] });
    expect(stepArrayFrame(state, frame, 1, '1')).toEqual({ nextIndex: 1 });
  });

  it('delegates to the commaOrEnd handler', () => {
    const frame = arrayFrame('commaOrEnd');
    const state = scanState({ stack: [frame] });
    expect(stepArrayFrame(state, frame, 2, ',')).toEqual({ nextIndex: 2 });
  });
});

describe('selectStep', () => {
  it('dispatches to the root frame when the stack is empty', () => {
    const state = scanState({ value: '42' });
    expect(selectStep(state, 0, '4')).toEqual({ nextIndex: 1 });
  });

  it('dispatches to the object frame handler when an object frame is on top', () => {
    const frame = objectFrame('commaOrEnd');
    const state = scanState({ stack: [frame] });
    expect(selectStep(state, 5, ',')).toEqual({ nextIndex: 5 });
    expect(frame.expect).toBe('keyOrEnd');
  });

  it('dispatches to the array frame handler when an array frame is on top', () => {
    const frame = arrayFrame('commaOrEnd');
    const state = scanState({ stack: [frame] });
    expect(selectStep(state, 5, ',')).toEqual({ nextIndex: 5 });
    expect(frame.expect).toBe('valueOrEnd');
  });
});

describe('emitJsonLine', () => {
  it('parses valid JSON, calls onMessage, and returns true', () => {
    const onMessage = vi.fn();
    expect(emitJsonLine('{"a":1}', onMessage)).toBe(true);
    expect(onMessage).toHaveBeenCalledWith({ a: 1 }, '{"a":1}');
  });

  it('returns false and does not call onMessage for invalid JSON', () => {
    const onMessage = vi.fn();
    expect(emitJsonLine('not json', onMessage)).toBe(false);
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('continuePendingJsonLine', () => {
  it('resolves and resets pending state when the combined candidate parses', () => {
    const onMessage = vi.fn();
    const state = accumulatorState({ pendingJson: '{"a":1,', pendingJsonLineCount: 1 });
    continuePendingJsonLine(state, '"b":2}', onMessage);
    expect(onMessage).toHaveBeenCalledWith({ a: 1, b: 2 }, '{"a":1,\n"b":2}');
    expect(state.pendingJson).toBe('');
    expect(state.pendingJsonLineCount).toBe(0);
  });

  it('keeps accumulating when the combined candidate is still incomplete and within budget', () => {
    const onMessage = vi.fn();
    const state = accumulatorState({ pendingJson: '{', pendingJsonLineCount: 1 });
    continuePendingJsonLine(state, '"a":1,', onMessage);
    expect(onMessage).not.toHaveBeenCalled();
    expect(state.pendingJson).toBe('{\n"a":1,');
    expect(state.pendingJsonLineCount).toBe(2);
  });

  it('abandons and retries the fresh line once the line-count budget is exceeded, even though the candidate is still structurally incomplete', () => {
    const onMessage = vi.fn();
    // `{"a":1,"b":2` + `\n,"c":3` is still a genuinely open object (no
    // closing brace) — classifyJsonCandidate would call it 'incomplete' on
    // its own. Starting at the 256-line cap means this line pushes the
    // count to 257, so the line-count guard (not the classification) is
    // what forces the abandon-and-retry path.
    const state = accumulatorState({ pendingJson: '{"a":1,"b":2', pendingJsonLineCount: 256 });
    continuePendingJsonLine(state, ',"c":3', onMessage);
    expect(onMessage).not.toHaveBeenCalled();
    expect(state.pendingJson).toBe('');
    expect(state.pendingJsonLineCount).toBe(0);
  });

  it('abandons and retries the fresh line once the byte budget is exceeded, even though the candidate is still structurally incomplete', () => {
    const onMessage = vi.fn();
    const state = accumulatorState({ pendingJson: '{"pad":"x', pendingJsonLineCount: 1 });
    // A single huge continuation line pushes the combined candidate over
    // 128_000 chars while it is still an open (unterminated) string —
    // structurally 'incomplete', so the byte-length guard is what forces
    // the abandon-and-retry path here, not the classification.
    const hugeLine = 'x'.repeat(129_000);
    continuePendingJsonLine(state, hugeLine, onMessage);
    expect(onMessage).not.toHaveBeenCalled();
    expect(state.pendingJson).toBe('');
    expect(state.pendingJsonLineCount).toBe(0);
  });

  it('abandons and retries the fresh line when the candidate resolves to invalid JSON', () => {
    const onMessage = vi.fn();
    const state = accumulatorState({ pendingJson: '{', pendingJsonLineCount: 1 });
    continuePendingJsonLine(state, 'bad line here', onMessage);
    expect(onMessage).not.toHaveBeenCalled();
    expect(state.pendingJson).toBe('');
    expect(state.pendingJsonLineCount).toBe(0);
  });
});

describe('tryStartPendingJsonLine', () => {
  it('starts a pending candidate for an incomplete line beginning with `{`', () => {
    const state = accumulatorState();
    tryStartPendingJsonLine(state, '{"a":1');
    expect(state.pendingJson).toBe('{"a":1');
    expect(state.pendingJsonLineCount).toBe(1);
  });

  it('starts a pending candidate for an incomplete line beginning with `[`', () => {
    const state = accumulatorState();
    tryStartPendingJsonLine(state, '[1,2');
    expect(state.pendingJson).toBe('[1,2');
  });

  it('does not start a pending candidate for a line that does not begin with `{` or `[`', () => {
    const state = accumulatorState();
    tryStartPendingJsonLine(state, 'hello world');
    expect(state.pendingJson).toBe('');
  });

  it('does not start a pending candidate when the line is already a complete value', () => {
    const state = accumulatorState();
    tryStartPendingJsonLine(state, '{}');
    expect(state.pendingJson).toBe('');
  });

  it('does not start a pending candidate when the line is invalid rather than incomplete', () => {
    const state = accumulatorState();
    tryStartPendingJsonLine(state, '{]');
    expect(state.pendingJson).toBe('');
  });
});

describe('handleJsonLine', () => {
  it('ignores a blank line', () => {
    const onMessage = vi.fn();
    const state = accumulatorState();
    handleJsonLine(state, '   ', onMessage);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('delegates to continuePendingJsonLine when a candidate is already pending', () => {
    const onMessage = vi.fn();
    const state = accumulatorState({ pendingJson: '{"a":1', pendingJsonLineCount: 1 });
    handleJsonLine(state, '}', onMessage);
    expect(onMessage).toHaveBeenCalledWith({ a: 1 }, '{"a":1\n}');
  });

  it('emits a line that parses standalone', () => {
    const onMessage = vi.fn();
    const state = accumulatorState();
    handleJsonLine(state, '{"a":1}', onMessage);
    expect(onMessage).toHaveBeenCalledWith({ a: 1 }, '{"a":1}');
  });

  it('falls through to tryStartPendingJsonLine when the line does not parse standalone', () => {
    const onMessage = vi.fn();
    const state = accumulatorState();
    handleJsonLine(state, '{"a":1', onMessage);
    expect(onMessage).not.toHaveBeenCalled();
    expect(state.pendingJson).toBe('{"a":1');
  });
});
