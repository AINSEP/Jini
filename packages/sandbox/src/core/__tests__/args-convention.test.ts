import { expect, test } from 'vitest';
import { SandboxOperationError } from '../index.js';
import { shellQuote } from '../../e2b/shell-quote.js';
import { toArrayBuffer } from '../../e2b/to-array-buffer.js';

test('object inputs preserve error causes and binary view boundaries', () => {
  const cause = new Error('offline');
  const error = new SandboxOperationError({ category: 'unavailable', message: 'Cannot boot' }, { cause });
  expect(error.category).toBe('unavailable');
  expect(error.message).toBe('Cannot boot');
  expect(error.cause).toBe(cause);
  expect(shellQuote({ value: "a'b" })).toBe("'a'\\''b'");
  expect([...new Uint8Array(toArrayBuffer({ bytes: new Uint8Array([1, 2, 3, 4]).subarray(1, 3) }))]).toEqual([2, 3]);
});
