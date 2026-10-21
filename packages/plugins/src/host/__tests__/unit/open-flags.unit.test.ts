import { constants } from 'node:fs';
import { expect, it } from 'vitest';
import { readNoFollowFlags } from '../../node/open-flags.js';

it('combines read-only with no-follow where the platform defines it (POSIX)', () => {
  expect(readNoFollowFlags({ constants: { O_RDONLY: 0, O_NOFOLLOW: 0o400000 } })).toBe(0o400000);
  expect(readNoFollowFlags({ constants })).toBe(constants.O_RDONLY | constants.O_NOFOLLOW);
});

it('falls back to a plain read-only open where no-follow is undefined (Windows)', () => {
  expect(readNoFollowFlags({ constants: { O_RDONLY: 0 } })).toBe(0);
  expect(readNoFollowFlags({ constants: { O_RDONLY: 4, O_NOFOLLOW: undefined } })).toBe(4);
});
