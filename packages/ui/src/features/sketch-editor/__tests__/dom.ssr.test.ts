// @vitest-environment node
//
// `readExcalidrawTheme`/`readDefaultSketchToolColor`'s `typeof document ===
// 'undefined'` guards only exercise their true branch when `document` is
// genuinely absent from the global scope, which holds only under Node's
// default (non-jsdom) environment — this package's package-wide default is
// jsdom, which always defines `document`. Splitting these two assertions
// into their own `node`-environment file (matching `utils/dom-subscriptions
// .test.ts`'s precedent) exercises the real SSR guard instead of a source
// change or a suppression comment. See `packages/ui/archived provenance ledger`.
import { describe, expect, it } from 'vitest';
import { applySketchDomTextOverrides, readDefaultSketchToolColor, readExcalidrawTheme } from '../dom.js';

describe('readExcalidrawTheme (SSR)', () => {
  it('defaults to light when document is undefined', () => {
    expect(typeof document).toBe('undefined');
    expect(readExcalidrawTheme()).toBe('light');
  });
});

describe('readDefaultSketchToolColor (SSR)', () => {
  it('defaults to the light tool color when document is undefined', () => {
    expect(typeof document).toBe('undefined');
    expect(readDefaultSketchToolColor()).toBe('#1c1b1a');
  });
});

describe('applySketchDomTextOverrides (SSR)', () => {
  it('is a no-op when document is undefined, even with real overrides', () => {
    expect(typeof document).toBe('undefined');
    expect(() => applySketchDomTextOverrides({} as ParentNode, { Close: 'Fermer' })).not.toThrow();
  });
});
