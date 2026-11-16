import { describe, expect, it } from 'vitest';
import { extensionForMimeType } from '../mime.js';

describe('extensionForMimeType', () => {
  it('maps image/avif to .avif', () => {
    expect(extensionForMimeType('image/avif')).toBe('.avif');
  });
  it('does not match by prefix or case', () => {
    expect(extensionForMimeType('image/png; charset=binary')).toBe('');
    expect(extensionForMimeType('IMAGE/PNG')).toBe('');
  });
});
