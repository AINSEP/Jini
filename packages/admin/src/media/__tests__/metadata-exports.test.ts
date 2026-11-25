import { describe, expect, it } from 'vitest';
import { formatUploadDate } from '../index.js';

describe('public media metadata formatters', () => {
  it('formats a late-evening upload in the supplied viewer time zone', () => {
    expect(formatUploadDate({ createdAt: '2026-11-25T07:30:00.000Z' }, {
      locale: 'en-US', viewerTimeZone: 'America/Los_Angeles',
    })).toBe('Nov 24, 2026');
  });

  it('exports UTC calendar-date formatting for host cards', () => {
    expect(formatUploadDate({ createdAt: '2026-10-03T23:30:00-02:00' })).toBe('Oct 4, 2026');
  });
});
