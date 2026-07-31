import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from '../../utils/uuid.js';

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('randomUUID', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('produces a well-formed v4 UUID via the native crypto.randomUUID tier', () => {
    expect(randomUUID()).toMatch(V4_RE);
  });

  it('produces distinct ids across calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomUUID()));
    expect(ids.size).toBe(50);
  });

  it('falls back to crypto.getRandomValues when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        arr.fill(0xab);
        return arr;
      },
    });
    const id = randomUUID();
    expect(id).toMatch(V4_RE);
    // version nibble forced to 4, variant nibble forced to 10xx (8-b).
    expect(id[14]).toBe('4');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('falls back to Math.random when the Web Crypto API is entirely unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    const id = randomUUID();
    expect(id).toMatch(V4_RE);
  });
});
