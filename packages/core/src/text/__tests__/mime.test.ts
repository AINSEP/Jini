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

it.each([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/svg+xml', '.svg'],
  ['text/html', '.html'],
  ['text/plain', '.txt'],
  ['application/octet-stream', ''],
])('uses the paste filename suffix for %s', (mimeType, extension) => {
  expect(extensionForMimeType({ mimeType })).toBe(extension);
});
