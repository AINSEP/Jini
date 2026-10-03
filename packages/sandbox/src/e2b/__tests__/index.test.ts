/**
 * Guards the `./e2b` public surface. The export map promises this subpath resolves and carries
 * these names; a rename inside the package that forgot the barrel would break every consumer
 * while every other test in this package still passed.
 */
import { describe, expect, it } from 'vitest';

import * as e2b from '../index.js';

describe('@jini-ai/sandbox/e2b barrel', () => {
  it('exports exactly the runtime surface it promises', () => {
    expect(Object.keys(e2b).sort()).toEqual([
      'DEFAULT_VITE_REACT_TEMPLATE',
      'categorizeE2bError',
      'createE2bSandboxProvider',
      'mapE2bFileChangeKind',
      'shellQuote',
      'toArrayBuffer',
      'wrapE2bSandbox',
    ]);
  });

  it('re-exports working implementations, not just names', () => {
    expect(typeof e2b.createE2bSandboxProvider).toBe('function');
    expect(typeof e2b.wrapE2bSandbox).toBe('function');
    expect(e2b.DEFAULT_VITE_REACT_TEMPLATE.length).toBeGreaterThan(0);
    expect(e2b.shellQuote({ value: 'a b' })).toBe("'a b'");
    expect(e2b.mapE2bFileChangeKind({ type: 'create' })).toBe('created');
    expect(e2b.categorizeE2bError({ error: new Error('boom') })).toBe('unknown');
    expect(e2b.toArrayBuffer({ bytes: new Uint8Array([1, 2, 3]) }).byteLength).toBe(3);
  });
});
