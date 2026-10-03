import { timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { timingSafeTokenMatch } from '@jini-ai/core';
import { createNodeCredentialCrypto } from '../run-credentials.js';

// PARITY: UTF-8 encoding and unequal-length refusal match the original Node adapter.
describe('credential token comparison', () => {
  it.each([
    ['', '', true], ['secret', 'secret', true], ['secret', 'Secret', false],
    ['short', 'longer', false], ['é', 'é', true], ['é', 'ab', false],
    ['\uD800', '\uFFFD', true], ['nul\u0000byte', 'nul\u0000byte', true],
  ])('compares %j and %j consistently', (presented, expected, matches) => {
    const native = createNodeCredentialCrypto({});
    expect(native.tokensMatch({ presented, expected })).toBe(matches);
    expect(timingSafeTokenMatch({ presented, expected,
      timingSafeEqual: ({ left, right }) => timingSafeEqual(left, right),
    })).toBe(matches);
  });
});
