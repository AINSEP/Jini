import { describe, expect, it } from 'vitest';

import { toArrayBuffer } from '../to-array-buffer.js';

describe('toArrayBuffer', () => {
  it('converts a Uint8Array that owns its whole buffer', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const buffer = toArrayBuffer(bytes);

    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('converts only the view\'s own range for a Uint8Array that is a subarray of a larger buffer', () => {
    // The adversarial case this function exists for: `.buffer` on a view is the WHOLE backing
    // buffer, not just the slice `subarray()` exposes. A naive `.buffer` pass-through would leak
    // the two bytes on either side of the view into the write.
    const backing = new Uint8Array([0xff, 1, 2, 3, 4, 0xff]);
    const view = backing.subarray(1, 5); // exactly [1, 2, 3, 4], byteOffset 1

    const buffer = toArrayBuffer(view);

    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(buffer.byteLength).toBe(4);
  });

  it('produces a fresh buffer, not a live view over the original', () => {
    const bytes = new Uint8Array([1, 2, 3]);

    const buffer = toArrayBuffer(bytes);
    bytes[0] = 99;

    expect(new Uint8Array(buffer)[0]).toBe(1);
  });

  it('converts an empty Uint8Array to a zero-length buffer', () => {
    expect(toArrayBuffer(new Uint8Array([])).byteLength).toBe(0);
  });
});
