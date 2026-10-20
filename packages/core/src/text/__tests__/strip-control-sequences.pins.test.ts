import { describe, expect, it } from 'vitest';
import { sanitizeUntrustedText, stripControlSequences } from '../index.js';

// Characterization pins for every branch of the control-sequence scanner. Control bytes are
// built at runtime so the source stays plain ASCII.
const ch = (code: number): string => String.fromCharCode(code);
const ESC = ch(0x1b);
const BEL = ch(0x07);
const strip = (text: string): string => stripControlSequences({ text });

describe('stripControlSequences: CSI', () => {
  it('ends a CSI at the lowest final byte "@"', () => {
    expect(strip(`a${ESC}[1@b`)).toBe('ab');
  });

  it('ends a CSI at the highest final byte "~"', () => {
    expect(strip(`a${ESC}[3~b`)).toBe('ab');
  });

  it('does not treat "?" (0x3f) or DEL (0x7f) as a CSI final byte', () => {
    expect(strip(`a${ESC}[?25${ch(0x7f)}hb`)).toBe('ab');
  });

  it('swallows newlines and other controls inside unterminated CSI parameters', () => {
    expect(strip(`a${ESC}[1\n2mX`)).toBe('aX');
  });

  it('drops everything after a truncated CSI that never reaches a final byte', () => {
    expect(strip(`keep${ESC}[12;3`)).toBe('keep');
  });

  it('drops a lone ESC [ at end of input', () => {
    expect(strip(`keep${ESC}[`)).toBe('keep');
  });
});

describe('stripControlSequences: OSC', () => {
  it('keeps scanning past an ESC inside an OSC that is not followed by a backslash', () => {
    expect(strip(`${ESC}]0;a${ESC}xb${BEL}c`)).toBe('c');
  });

  it('drops the rest of the input for an OSC that is never terminated', () => {
    expect(strip(`keep${ESC}]0;title without end`)).toBe('keep');
  });

  it('drops an OSC whose last byte is a dangling ESC', () => {
    expect(strip(`keep${ESC}]0;t${ESC}`)).toBe('keep');
  });

  it('drops an OSC terminated by ST at the very end of input', () => {
    expect(strip(`keep${ESC}]0;t${ESC}\\`)).toBe('keep');
  });

  it('drops a lone ESC ] at end of input', () => {
    expect(strip(`keep${ESC}]`)).toBe('keep');
  });

  it('stops the OSC at the first BEL so later text survives', () => {
    expect(strip(`${ESC}]8;;x${BEL}link${ESC}]8;;${BEL}!`)).toBe('link!');
  });
});

describe('stripControlSequences: bare ESC', () => {
  it('drops a trailing ESC', () => {
    expect(strip(`ab${ESC}`)).toBe('ab');
  });

  it('drops a first ESC and still parses the CSI introduced by a second', () => {
    expect(strip(`${ESC}${ESC}[31mX`)).toBe('X');
  });

  it('drops only the ESC of a two-byte escape such as ESC c', () => {
    expect(strip(`${ESC}cReset`)).toBe('cReset');
  });
});

describe('stripControlSequences: single-code-unit controls', () => {
  it('strips 0x1f but keeps the space 0x20', () => {
    expect(strip(`a${ch(0x1f)}${ch(0x20)}b`)).toBe('a b');
  });

  it('keeps "~" (0x7e) and strips DEL (0x7f)', () => {
    expect(strip(`a~${ch(0x7f)}b`)).toBe('a~b');
  });

  it('strips the C1 boundaries 0x80 and 0x9f plus NEL 0x85, but keeps NBSP 0xa0', () => {
    expect(strip(`a${ch(0x80)}${ch(0x85)}${ch(0x9f)}${ch(0xa0)}b`)).toBe(`a${ch(0xa0)}b`);
  });

  it('strips an 8-bit C1 CSI introducer but keeps its parameter bytes as plain text', () => {
    expect(strip(`${ch(0x9b)}31mred`)).toBe('31mred');
  });

  it('keeps tab, line feed and carriage return', () => {
    expect(strip('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  it('strips vertical tab and form feed (they are C0 controls)', () => {
    expect(strip(`a${ch(0x0b)}${ch(0x0c)}b`)).toBe('ab');
  });

  it('keeps astral characters (surrogate pairs) intact', () => {
    expect(strip('a\u{1F600}b')).toBe('a\u{1F600}b');
  });

  it('returns an empty string for empty input', () => {
    expect(strip('')).toBe('');
  });

  // Bidi overrides (U+202E RLO, U+2066..U+2069 isolates) are not C0/C1 controls, so they reach
  // the terminal and can visually reorder the surrounding text (Trojan-Source style spoofing).
  it('passes Unicode bidi override and isolate characters through (reported, not fixed)', () => {
    const bidi = '‮⁦⁩‏';
    expect(strip(`a${bidi}b`)).toBe(`a${bidi}b`);
  });
});

describe('sanitizeUntrustedText: diagnostic vocabulary', () => {
  it('keeps an exact schema keyword that would otherwise look opaque', () => {
    expect(sanitizeUntrustedText({ text: 'unevaluatedProperties' })).toBe('unevaluatedProperties');
  });

  it('redacts the same opaque span when it is not in the vocabulary', () => {
    expect(sanitizeUntrustedText({ text: 'unevaluatedPropertiez' })).toBe('[redacted]');
  });
});
