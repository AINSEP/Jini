import { describe, expect, it } from 'vitest';
import { diffAddedLines, formatRevisionTimestamp } from './rules.js';

describe('diffAddedLines', () => {
  it('returns everything after the common prefix', () => {
    expect(diffAddedLines({ baseText: 'a\nb\nc', proposedText: 'a\nb\nd\ne' })).toBe('d\ne');
  });

  it('returns an empty string when the texts are identical', () => {
    expect(diffAddedLines({ baseText: 'a\nb', proposedText: 'a\nb' })).toBe('');
  });

  it('returns the whole proposed text when nothing is shared', () => {
    expect(diffAddedLines({ baseText: 'x', proposedText: 'a\nb' })).toBe('a\nb');
  });

  it('returns an empty string when the proposed text is a strict prefix truncation of the base', () => {
    expect(diffAddedLines({ baseText: 'a\nb\nc', proposedText: 'a\nb' })).toBe('');
  });

  it('handles CRLF line endings the same as LF', () => {
    expect(diffAddedLines({ baseText: 'a\r\nb', proposedText: 'a\r\nb\r\nc' })).toBe('c');
  });

  it('handles empty inputs', () => {
    expect(diffAddedLines({ baseText: '', proposedText: '' })).toBe('');
    expect(diffAddedLines({ baseText: '', proposedText: 'a' })).toBe('a');
  });
});

describe('formatRevisionTimestamp', () => {
  it('formats a valid ISO timestamp', () => {
    const formatted = formatRevisionTimestamp({ value: '2026-03-01T10:30:00.000Z' });
    expect(formatted).toMatch(/\w+ \d+,? \d{1,2}:\d{2}/);
  });

  it('returns the raw value unchanged when it does not parse as a date', () => {
    expect(formatRevisionTimestamp({ value: 'not-a-date' })).toBe('not-a-date');
  });
});
