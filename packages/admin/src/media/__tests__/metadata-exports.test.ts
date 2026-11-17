import { describe, expect, it } from 'vitest';
import { formatUploadDate } from '../index.js';

describe('public media metadata formatters', () => {
  it('exports UTC calendar-date formatting for host cards', () => {
    expect(formatUploadDate({ createdAt: '2026-10-03T23:30:00-02:00' })).toBe('Oct 4, 2026');
  });
});
