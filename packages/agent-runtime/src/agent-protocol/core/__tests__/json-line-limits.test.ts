import { describe, expect, it, vi } from 'vitest';

import { type JsonLineAccumulatorState, tryStartPendingJsonLine } from '../json-line-stream.js';

describe('tryStartPendingJsonLine size limit', () => {
  const fresh = (): JsonLineAccumulatorState => ({ pendingJson: '', pendingJsonLineCount: 0 });
  const oversized = `{"k":"${'x'.repeat(128_000)}`;

  it('reports a RangeError and does not start aggregating a line over 128000 characters', () => {
    const onError = vi.fn();
    const state = fresh();
    tryStartPendingJsonLine(state, oversized, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    const error = onError.mock.calls[0]![0] as RangeError;
    expect(error).toBeInstanceOf(RangeError);
    expect(error.message).toBe('Agent output multiline JSON exceeded 128000 characters or 256 lines.');
    expect(state).toEqual({ pendingJson: '', pendingJsonLineCount: 0 });
  });

  it('silently drops the oversized line when no error handler is given', () => {
    const state = fresh();
    expect(() => tryStartPendingJsonLine(state, oversized)).not.toThrow();
    expect(state.pendingJson).toBe('');
  });

  it('starts aggregating an unfinished object and ignores a non-JSON line', () => {
    const state = fresh();
    tryStartPendingJsonLine(state, 'plain text');
    expect(state.pendingJson).toBe('');
    tryStartPendingJsonLine(state, '{"a":');
    expect(state.pendingJson).toBe('{"a":');
  });
});
