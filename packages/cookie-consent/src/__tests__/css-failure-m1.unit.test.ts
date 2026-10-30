import { afterEach, expect, it, vi } from 'vitest';
import * as parser from '../render/css-parser.js';
import { compileConsentCss } from '../render/css.js';

afterEach(() => { vi.restoreAllMocks(); });

it.each([new TypeError('parser dependency failed'), 'parser dependency failed'])('propagates a parser fault without misreporting it as authored CSS syntax: %s', failure => {
  vi.spyOn(parser, 'parseConsentCss').mockImplementationOnce(() => { throw failure; });
  let caught: unknown = Symbol('no failure');
  try { compileConsentCss({ css: '#jini-consent{padding:12px}' }); }
  catch (error) { caught = error; }
  expect(caught).toBe(failure);
});
