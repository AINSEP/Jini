import { describe, expect, it } from 'vitest';
import { formatByteSize, formatUploadDate } from '../index.js';

describe('public media metadata formatters', () => {
  it('exports size and UTC calendar-date formatting for host cards', () => {
    expect(formatByteSize({ bytes: 9_961_472 })).toBe('9.5 MB');
    expect(formatUploadDate({ createdAt: '2026-10-03T23:30:00-02:00' })).toBe('Oct 4, 2026');
  });
});
