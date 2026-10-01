import { describe, expect, it } from 'vitest';
import { redactSecretLike, sanitizeUnknownDeep, sanitizeUntrustedText, stripControlSequences } from '../redact.js';

// Built via fromCharCode rather than escape literals so the exact bytes under test are
// unambiguous in this source file rather than relying on how an escape sequence is transcribed.
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

describe('stripControlSequences', () => {
  it('leaves plain text untouched', () => {
    expect(stripControlSequences('hello world')).toBe('hello world');
  });

  it('strips a CSI (color) escape sequence', () => {
    expect(stripControlSequences(`${ESC}[31mred${ESC}[0m text`)).toBe('red text');
  });

  it('strips an OSC sequence terminated by BEL', () => {
    expect(stripControlSequences(`${ESC}]0;window title${BEL}rest`)).toBe('rest');
  });

  it('strips an OSC sequence terminated by ESC \\\\ (ST)', () => {
    expect(stripControlSequences(`${ESC}]0;window title${ESC}\\rest`)).toBe('rest');
  });

  it('strips a bare/unrecognized ESC-prefixed byte', () => {
    expect(stripControlSequences(`before${ESC}Xafter`)).toBe('beforeXafter');
  });

  it('strips other C0 control characters but keeps tab/newline/carriage-return', () => {
    const withControls = `a${String.fromCharCode(0x00)}b${String.fromCharCode(0x07)}c\td\ne\rf`;
    expect(stripControlSequences(withControls)).toBe('abc\td\ne\rf');
  });

  it('strips DEL and C1 control characters', () => {
    const withControls = `a${String.fromCharCode(0x7f)}b${String.fromCharCode(0x9b)}c`;
    expect(stripControlSequences(withControls)).toBe('abc');
  });
});

describe('redactSecretLike', () => {
  it('leaves ordinary short text untouched', () => {
    expect(redactSecretLike('need x, got y')).toBe('need x, got y');
  });

  it('redacts a labeled Authorization header value', () => {
    const result = redactSecretLike('Authorization: some-header-value-123');
    expect(result).not.toContain('some-header-value-123');
    expect(result).toContain('[redacted]');
  });

  it('redacts a long opaque-token-looking substring with no label', () => {
    const token = 'A'.repeat(32);
    const result = redactSecretLike(`session=${token} ok`);
    expect(result).not.toContain(token);
    expect(result).toContain('[redacted]');
  });

  it('does not redact short identifiers', () => {
    expect(redactSecretLike('field=short-id-here')).toBe('field=short-id-here');
  });

  // 2026-10-01: a delegated tool failure reached the model as
  // `daemon 500 on .../api/[redacted]: INTERNAL_ERROR: Error [redacted]: ...` — the host's
  // correlation id and the daemon route both matched the 20+-char opaque-token rule.
  it('keeps a host error id (ERR-XXXX-XXXX-XXXX-XXXX) and the delegated-tool-calls route', () => {
    const message =
      'daemon 500 on http://127.0.0.1:54320/api/delegated-tool-calls: INTERNAL_ERROR: Error ERR-AAAA-1111-BBBB-2222: ToolExecutor: unknown tool "zz_no_such_tool"';
    expect(redactSecretLike(message)).toBe(message);
  });

  it('still redacts a secret of the same length and alphabet as an error id that is not exactly one', () => {
    // 23 chars, like an error id, but lower-case hex and no ERR- prefix.
    const lookalike = 'abcd-1111-bbbb-2222-eee';
    // An error id glued to more token characters is one longer run, not an error id.
    const glued = 'ERR-AAAA-1111-BBBB-2222ffff';
    const result = redactSecretLike(`a ${lookalike} b ${glued} c`);
    expect(result).toBe('a [redacted] b [redacted] c');
  });

  it('still redacts a 20-character token that is not a known route segment', () => {
    expect(redactSecretLike('/api/delegated-tool-callz')).toBe('/api/[redacted]');
    expect(redactSecretLike('x delegated-tool-calls-and-more y')).toBe('x [redacted] y');
  });
});

describe('sanitizeUntrustedText', () => {
  it('strips control sequences and redacts secrets in one pass', () => {
    const secret = 'B'.repeat(25);
    const result = sanitizeUntrustedText(`${ESC}[31m${secret}${ESC}[0m`);
    expect(result).not.toContain(ESC);
    expect(result).not.toContain(secret);
  });

  it('returns short, clean text unchanged', () => {
    expect(sanitizeUntrustedText('all good here')).toBe('all good here');
  });

  it('truncates text past the default 500-character cap with a visible marker', () => {
    const long = 'word '.repeat(200); // 1000 chars, no long alnum run to redact
    const result = sanitizeUntrustedText(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('truncated');
  });

  it('honors a custom maxLength', () => {
    const result = sanitizeUntrustedText('word '.repeat(50), { maxLength: 20 });
    expect(result.startsWith('word word word word'.slice(0, 20))).toBe(true);
    expect(result).toContain('truncated');
  });
});

describe('sanitizeUnknownDeep', () => {
  it('sanitizes string leaves inside a nested object', () => {
    const secret = 'C'.repeat(30);
    const input = { outer: { inner: [`value=${secret}`, 'fine'] } };
    const result = sanitizeUnknownDeep(input) as { outer: { inner: string[] } };
    expect(result.outer.inner[0]).not.toContain(secret);
    expect(result.outer.inner[1]).toBe('fine');
  });

  it('passes numbers, booleans, and null through unchanged', () => {
    expect(sanitizeUnknownDeep(42)).toBe(42);
    expect(sanitizeUnknownDeep(true)).toBe(true);
    expect(sanitizeUnknownDeep(null)).toBeNull();
  });

  it('caps recursion depth with a placeholder instead of recursing forever', () => {
    let deep: unknown = 'bottom';
    for (let i = 0; i < 10; i++) deep = { nested: deep };
    const result = JSON.stringify(sanitizeUnknownDeep(deep));
    expect(result).toContain('omitted');
  });

  it('caps array length', () => {
    const input = Array.from({ length: 200 }, (_, i) => i);
    const result = sanitizeUnknownDeep(input) as unknown[];
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('caps object key count', () => {
    const input: Record<string, number> = {};
    for (let i = 0; i < 200; i++) input[`k${i}`] = i;
    const result = sanitizeUnknownDeep(input) as Record<string, number>;
    expect(Object.keys(result).length).toBeLessThanOrEqual(50);
  });
});
