import { describe, expect, it } from 'vitest';
import { describeUploadOverLimit } from '../upload-limit-message.js';

const MIB = 1024 * 1024;

describe('describeUploadOverLimit', () => {
  it('names the file size and the limit in plain words', () => {
    expect(describeUploadOverLimit({ fileBytes: 200 * MIB, limitBytes: 50 * MIB })).toBe('That file is 200 MB; the limit is 50 MB.');
  });

  it('keeps one decimal on a file that is only a little over, and never rounds it down to the limit', () => {
    // 50 MiB + 1 byte must not read "That file is 50 MB; the limit is 50 MB."
    expect(describeUploadOverLimit({ fileBytes: 50 * MIB + 1, limitBytes: 50 * MIB })).toBe('That file is 50.1 MB; the limit is 50 MB.');
    expect(describeUploadOverLimit({ fileBytes: 10.5 * MIB, limitBytes: 5 * MIB })).toBe('That file is 10.5 MB; the limit is 5 MB.');
  });

  it('keeps a fractional limit as one decimal', () => {
    expect(describeUploadOverLimit({ fileBytes: 3 * MIB, limitBytes: 2.5 * MIB })).toBe('That file is 3 MB; the limit is 2.5 MB.');
  });

  it('uses KB and bytes for limits below a megabyte, so a small limit never reads as 0 MB', () => {
    expect(describeUploadOverLimit({ fileBytes: 300 * 1024, limitBytes: 100 * 1024 })).toBe('That file is 300 KB; the limit is 100 KB.');
    expect(describeUploadOverLimit({ fileBytes: 101, limitBytes: 100 })).toBe('That file is 101 bytes; the limit is 100 bytes.');
  });
});
