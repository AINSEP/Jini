import { describe, expect, it } from 'vitest';
import { MASKED_IDENTIFIER_ROWS } from '../masked-identifier-rows.js';
import { sanitizeUntrustedText } from '../sanitize-untrusted-text.js';

/** What `sanitizeUntrustedText` prints today for each row, with identifiers kept and no trusted tokens. */
const TODAY: Readonly<Record<number, string>> = {
  1: 'Call publish_job_status_read with {}',
  2: 'Declared inputs: viewport (optional), fullPage (optional), [redacted] (optional)',
  3: "media_asset '[redacted]' was not found",
  4: 'execution [redacted] for theme_write_file is still pending',
  5: 'tool "[redacted]" timed out before it finished',
};

describe('masked identifier rows (characterization)', () => {
  it.each(MASKED_IDENTIFIER_ROWS)('row $row prints today\'s text without a vocabulary', ({ row, text }) => {
    expect(sanitizeUntrustedText({ text }, { keepIdentifiers: true })).toBe(TODAY[row]);
  });
});
