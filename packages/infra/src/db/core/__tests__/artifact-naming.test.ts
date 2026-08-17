import { describe, expect, it } from 'vitest';

import { restorePointFilename, sanitizeForFilename } from '../artifact-naming.js';

describe('sanitizeForFilename', () => {
  it('passes through characters that are already filesystem-safe', () => {
    expect(sanitizeForFilename('workspace-1_abc')).toBe('workspace-1_abc');
  });

  it('neutralizes path separators so a scopeId cannot nest the artifact', () => {
    expect(sanitizeForFilename('a/b\\c')).toBe('a_b_c');
  });

  it('neutralizes dots so a scopeId of ".." cannot climb out of the target directory', () => {
    expect(sanitizeForFilename('..')).toBe('__');
  });

  it('replaces rather than rejects, so an unusual slug still yields a backup', () => {
    expect(sanitizeForFilename('café: prod')).toBe('caf___prod');
  });
});

describe('restorePointFilename', () => {
  it('embeds the watermark so a directory listing is readable without the ledger', () => {
    expect(restorePointFilename({ scopeId: 'store', watermarkAtCapture: 42, timestamp: 1700000000000 })).toBe(
      'restore-point-store-wm42-1700000000000.db',
    );
  });

  it('defaults the extension to .db', () => {
    expect(
      restorePointFilename({ scopeId: 's', watermarkAtCapture: 0, timestamp: 1 }).endsWith('.db'),
    ).toBe(true);
  });

  it('honours an explicit extension, so a non-file-snapshot driver can reuse the scheme', () => {
    expect(restorePointFilename({ scopeId: 's', watermarkAtCapture: 0, timestamp: 1, extension: 'sql' })).toBe(
      'restore-point-s-wm0-1.sql',
    );
  });

  it('sanitizes the scopeId it is given rather than trusting the caller', () => {
    expect(restorePointFilename({ scopeId: '../../etc', watermarkAtCapture: 1, timestamp: 2 })).toBe(
      'restore-point-______etc-wm1-2.db',
    );
  });
});
