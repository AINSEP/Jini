import { describe, expect, it } from 'vitest';
import { redactUserText } from '../user-text-redaction.js';

// The one engine (core) must give chat's user text every answer chat's own rules gave before E2 moved it
// there. Each describe names the class of text in neutral words; the engine rule lives in core.
const kept = (text: string) => ({ text, secretRedacted: false, count: 0 });

describe('a name that only ends in a scheme word is prose', () => {
  it.each(['TokenBearer is a class', 'The TokenBearer pattern', 'TokenBearer abc'])('keeps %j', text => {
    expect(redactUserText({ text })).toEqual(kept(text));
  });
  it('still masks the word after a real Bearer', () => {
    expect(redactUserText({ text: 'Bearer x1' })).toEqual({ text: 'Bearer [token removed]', secretRedacted: true, count: 1 });
  });
});
