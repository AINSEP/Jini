// @vitest-environment node
//
// `isDarkMode()`'s `typeof document === 'undefined'` guard only exercises its
// true branch when `document` is genuinely absent from the global scope,
// which holds only under Node's default (non-jsdom) environment — this
// package's package-wide default is jsdom, which always defines `document`.
// Splitting this assertion into its own `node`-environment file (matching
// this package's own `features/sketch-editor/dom.ssr.test.ts` precedent) exercises
// the real SSR guard instead of a source change or a suppression comment.
// See `packages/ui/src/renderers/source-map.md`.
import { describe, expect, it } from 'vitest';
import { highlightCode } from '../shiki.js';

describe('highlightCode (SSR)', () => {
  it('uses the light theme when document is undefined, regardless of matchMedia', () => {
    expect(typeof document).toBe('undefined');
    return highlightCode('const ssr = true;', 'javascript').then((html) => {
      expect(html).toContain('github-light-default');
    });
  }, 20000);
});
