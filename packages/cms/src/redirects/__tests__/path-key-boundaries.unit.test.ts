import { expect, it } from 'vitest';
import { redirectPathKey, sameRedirectPath } from '../path-key.js';

it('uses the root key for an empty path and for any sequence of root slashes', () => {
  expect(redirectPathKey({ path: '' })).toBe('/');
  expect(redirectPathKey({ path: '////' })).toBe('/');
  expect(sameRedirectPath({ a: '', b: '/' })).toBe(true);
});

it('preserves case, malformed escapes and encoded segment boundaries when comparing paths', () => {
  expect(sameRedirectPath({ a: '/caf%C3%A9///', b: '/café' })).toBe(true);
  expect(sameRedirectPath({ a: '/A', b: '/a' })).toBe(false);
  expect(sameRedirectPath({ a: '/a%2Fb', b: '/a/b' })).toBe(false);
  expect(sameRedirectPath({ a: '/a%2fb/', b: '/a%2Fb' })).toBe(true);
  expect(redirectPathKey({ path: '/bad%E0%A4/' })).toBe('/bad%E0%A4');
});
