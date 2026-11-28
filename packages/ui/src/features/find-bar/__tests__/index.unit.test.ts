import { describe, expect, it } from 'vitest';
import * as entry from '../index.js';
import { FindBar } from '../FindBar.js';

/** `index.ts` is the published `./find-bar` subpath. */
describe('find-bar public entry', () => {
  it('exposes exactly FindBar, bound to the implementing module', () => {
    expect(Object.keys(entry)).toEqual(['FindBar']);
    expect(entry.FindBar).toBe(FindBar);
  });
});
