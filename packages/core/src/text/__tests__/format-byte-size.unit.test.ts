import { describe, expect, it } from 'vitest';
import { formatByteSize } from '../format-byte-size.js';

describe('formatByteSize', () => {
  // 1024-based units must agree with upload caps; MB/GB keep precision so different clips
  // do not misleadingly collapse to the same whole-number size.
  it.each([
    [0, '0 B'], [823, '823 B'], [823.6, '824 B'], [1023, '1023 B'],
    [1024, '1 KB'], [839_680, '820 KB'], [1023 * 1024, '1023 KB'],
    [1024 * 1024, '1.0 MB'], [9_961_472, '9.5 MB'],
    [10 * 1024 * 1024, '10.0 MB'], [1024 ** 3, '1.0 GB'], [1_288_490_189, '1.2 GB'],
  ])('formats %s bytes as %s', (bytes, expected) => {
    expect(formatByteSize({ bytes })).toBe(expected);
  });

  it('uses the locale decimal separator and defaults to en-US', () => {
    expect(formatByteSize({ bytes: 9_961_472 }, { locale: 'de-DE' })).toBe('9,5 MB');
    expect(formatByteSize({ bytes: 9_961_472 })).toBe(formatByteSize({ bytes: 9_961_472 }, { locale: 'en-US' }));
  });

  it('lets the host relabel the megabyte band only', () => {
    expect(formatByteSize({ bytes: 3 * 1024 ** 2 }, { megabyteLabel: 'MiB' })).toBe('3.0 MiB');
    expect(formatByteSize({ bytes: 2048 }, { megabyteLabel: 'MiB' })).toBe('2 KB');
    expect(formatByteSize({ bytes: 1024 ** 3 }, { megabyteLabel: 'MiB' })).toBe('1.0 GB');
  });
});
