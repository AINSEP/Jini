/**
 * @file The one error ID format. Pins moved here with the function from the daemon's tool-recovery
 * tests, plus the reason the format exists: the user-facing formatter finds the ID inside plain text.
 */
import { expect, test } from 'vitest';
import { formatUserFacingError } from '../../user-facing-error.js';
import { mintToolErrorId } from '../error-id.js';

test('formats the 8 random bytes it asks for as four upper-case groups', () => {
  const requested: number[] = [];
  const id = mintToolErrorId({ randomHex: ({ bytes }) => { requested.push(bytes); return '0123456789abcdef'; } });
  expect(id).toBe('ERR-0123-4567-89AB-CDEF');
  expect(requested).toEqual([8]);
  expect(mintToolErrorId({ randomHex: ({ bytes }) => 'ab'.repeat(bytes) })).toBe('ERR-ABAB-ABAB-ABAB-ABAB');
});

test('a source that returns nothing yields a visibly empty ID, not a throw', () => {
  expect(mintToolErrorId({ randomHex: () => '' })).toBe('ERR-');
});

test('a minted ID survives as words: the formatter recovers it from a rebuilt error message', () => {
  const id = mintToolErrorId({ randomHex: () => '0123456789abcdef' });
  const rebuilt = new Error(`The site export could not be completed. (error ${id})`);
  const failure = formatUserFacingError({ message: 'The export failed.', action: 'Try again.', step: 'Export the site', cause: rebuilt });
  expect(failure.errorId).toBe('ERR-0123-4567-89AB-CDEF');
});
