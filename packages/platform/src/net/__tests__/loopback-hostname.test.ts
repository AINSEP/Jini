import { describe, expect, it } from 'vitest';
import { isLoopbackHostname } from '../address.js';
describe('isLoopbackHostname', () => {
  // PARITY: copied local-daemon hostname policy vector.
  it('accepts localhost', () => {
    expect(isLoopbackHostname({ hostname: 'localhost' })).toBe(true);
    expect(isLoopbackHostname({ hostname: 'LOCALHOST' })).toBe(true);
  });

  // PARITY: copied local-daemon hostname policy vector.

  it('accepts IPv6 loopback in bracketed and unbracketed forms', () => {
    expect(isLoopbackHostname({ hostname: '::1' })).toBe(true);
    expect(isLoopbackHostname({ hostname: '[::1]' })).toBe(true);
    expect(isLoopbackHostname({ hostname: '0:0:0:0:0:0:0:1' })).toBe(true);
  });

  // PARITY: copied local-daemon hostname policy vector.

  it('accepts the 127.0.0.0/8 IPv4 range', () => {
    expect(isLoopbackHostname({ hostname: '127.0.0.1' })).toBe(true);
    expect(isLoopbackHostname({ hostname: '127.5.6.7' })).toBe(true);
  });

  // PARITY: copied local-daemon hostname policy vector.

  it('rejects a non-loopback IPv4 address', () => {
    expect(isLoopbackHostname({ hostname: '8.8.8.8' })).toBe(false);
  });

  // PARITY: copied local-daemon hostname policy vector.

  it('rejects a public hostname', () => {
    expect(isLoopbackHostname({ hostname: 'example.com' })).toBe(false);
  });

  // PARITY: copied local-daemon hostname policy vector.

  it('rejects a falsy/empty hostname', () => {
    expect(isLoopbackHostname({ hostname: undefined })).toBe(false);
    expect(isLoopbackHostname({ hostname: '' })).toBe(false);
  });
});

