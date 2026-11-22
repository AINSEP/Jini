import { expect, test } from 'vitest';
import { htmlToText } from '../html-document.js';

/** Pinned by a host that used to re-export this parser: inline markup collapses to its text. */
test('htmlToText reduces inline markup to its text', () => {
  expect(htmlToText({ html: '<p>Hello <b>world</b></p>' }).trim()).toBe('Hello world');
});
