import { describe, expect, it } from 'vitest';
import { testStatusLabel } from '../../../features/notifications/index.js';

const labels = { testSentLabel: 'Sent!', testFailedLabel: 'Failed!' };

describe('testStatusLabel', () => {
  it('returns the sent label for a "sent" result', () => {
    expect(testStatusLabel('sent', labels)).toBe('Sent!');
  });

  it('returns the failed label for a "failed" result', () => {
    expect(testStatusLabel('failed', labels)).toBe('Failed!');
  });
});
