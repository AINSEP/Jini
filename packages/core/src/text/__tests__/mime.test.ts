import { describe, expect, it } from 'vitest';
import { extensionForMimeType } from '../mime.js';

describe('extensionForMimeType', () => {
  it('maps image/avif to .avif', () => {
    expect(extensionForMimeType({ mimeType: 'image/avif' })).toBe('.avif');
  });
  it('does not match by prefix or case', () => {
    expect(extensionForMimeType({ mimeType: 'image/png; charset=binary' })).toBe('');
    expect(extensionForMimeType({ mimeType: 'IMAGE/PNG' })).toBe('');
  });
});
