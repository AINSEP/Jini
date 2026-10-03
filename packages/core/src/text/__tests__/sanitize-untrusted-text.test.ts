import { describe, expect, it } from 'vitest';
import { sanitizeUntrustedText, stripControlSequences } from '../index.js';

// Construct actual control bytes, independent of escape transcription.
const ESC = String.fromCharCode(0x1b);

describe('sanitizeUntrustedText', () => {
  it('strips control sequences and redacts secrets in one pass', () => {
    const secret = 'B'.repeat(25);
    const result = sanitizeUntrustedText({ text: `${ESC}[31m${secret}${ESC}[0m` });
    expect(result).not.toContain(ESC);
    expect(result).not.toContain(secret);
  });

  it('returns short, clean text unchanged', () => {
    expect(sanitizeUntrustedText({ text: 'all good here' })).toBe('all good here');
  });

  it('truncates text past the default 500-character cap with a visible marker', () => {
    const long = 'word '.repeat(200); // 1000 chars, no long alnum run to redact
    const result = sanitizeUntrustedText({ text: long });
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('truncated');
  });

  it('honors a custom maxLength', () => {
    const result = sanitizeUntrustedText({ text: 'word '.repeat(50) }, { maxLength: 20 });
    expect(result).toBe('word wo… [truncated]');
    expect(result.length).toBe(20);
    expect(result).toContain('truncated');
  });
});


describe('sanitizer boundary cases', () => {
  it.each([0, 1, 5, 13, 20])('includes the truncation marker within a %i-character budget', maxLength => {
    const result = sanitizeUntrustedText({ text: 'word '.repeat(200) }, { maxLength });
    expect(result.length).toBe(maxLength);
    expect(result).toBe(maxLength < 13 ? '… [truncated]'.slice(0, maxLength)
      : `${'word '.repeat(200).slice(0, maxLength - 13)}… [truncated]`);
  });

  it('normalizes negative, fractional and non-finite length limits', () => {
    expect(sanitizeUntrustedText({ text: 'words' }, { maxLength: -1 })).toBe('');
    expect(sanitizeUntrustedText({ text: 'words' }, { maxLength: 2.9 })).toBe('… ');
    for (const maxLength of [NaN, Infinity, -Infinity]) {
      expect(sanitizeUntrustedText({ text: 'word '.repeat(200) }, { maxLength }).length).toBe(500);
    }
  });

  it('strips CSI, OSC terminated by BEL or ST, C0, DEL and C1 while keeping whitespace', () => {
    const bel = String.fromCharCode(7);
    expect(sanitizeUntrustedText({ text: `${ESC}]0;title${bel}rest` })).toBe('rest');
    expect(sanitizeUntrustedText({ text: `${ESC}]0;title${ESC}\\rest` })).toBe('rest');
    expect(sanitizeUntrustedText({ text: `a${String.fromCharCode(0, 127, 155)}b\tc\nd\re` })).toBe('ab\tc\nd\re');
  });

  it('retains correlation IDs and the route, but masks a glued secret', () => {
    expect(sanitizeUntrustedText({ text: 'ERR-AAAA-1111-BBBB-2222 delegated-tool-calls' }))
      .toBe('ERR-AAAA-1111-BBBB-2222 delegated-tool-calls');
    expect(sanitizeUntrustedText({ text: 'ERR-AAAA-1111-BBBB-2222ffff' })).toBe('[redacted]');
  });
});

const BEL = String.fromCharCode(0x07);
describe('stripControlSequences', () => {
  // PARITY
  it('leaves plain text untouched', () => {
    expect(stripControlSequences({ text: 'hello world' })).toBe('hello world');
  });

  // PARITY
  it('strips a CSI (color) escape sequence', () => {
    expect(stripControlSequences({ text: `${ESC}[31mred${ESC}[0m text` })).toBe('red text');
  });

  // PARITY
  it('strips an OSC sequence terminated by BEL', () => {
    expect(stripControlSequences({ text: `${ESC}]0;window title${BEL}rest` })).toBe('rest');
  });

  // PARITY
  it('strips an OSC sequence terminated by ESC \\\\ (ST)', () => {
    expect(stripControlSequences({ text: `${ESC}]0;window title${ESC}\\rest` })).toBe('rest');
  });

  // PARITY
  it('strips a bare/unrecognized ESC-prefixed byte', () => {
    expect(stripControlSequences({ text: `before${ESC}Xafter` })).toBe('beforeXafter');
  });

  // PARITY
  it('strips other C0 control characters but keeps tab/newline/carriage-return', () => {
    const withControls = `a${String.fromCharCode(0x00)}b${String.fromCharCode(0x07)}c\td\ne\rf`;
    expect(stripControlSequences({ text: withControls })).toBe('abc\td\ne\rf');
  });

  // PARITY
  it('strips DEL and C1 control characters', () => {
    const withControls = `a${String.fromCharCode(0x7f)}b${String.fromCharCode(0x9b)}c`;
    expect(stripControlSequences({ text: withControls })).toBe('abc');
  });
});

