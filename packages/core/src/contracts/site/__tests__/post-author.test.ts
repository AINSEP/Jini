import { expect, it } from 'vitest';
import { postAuthorForDisplay } from '../post-author.js';

it('exposes only an opted-in nonblank byline, with surrounding whitespace removed', () => {
  expect(postAuthorForDisplay({ post: { showAuthor: true, author: '  Toni Morrison  ' } })).toBe('Toni Morrison');
  expect(postAuthorForDisplay({ post: { showAuthor: false, author: 'Private name' } })).toBeNull();
  expect(postAuthorForDisplay({ post: { author: 'Legacy private name' } })).toBeNull();
  expect(postAuthorForDisplay({ post: { showAuthor: true, author: ' \t ' } })).toBeNull();
  expect(postAuthorForDisplay({ post: { showAuthor: true, author: null } })).toBeNull();
  expect(postAuthorForDisplay({ post: { showAuthor: true } })).toBeNull();
});
