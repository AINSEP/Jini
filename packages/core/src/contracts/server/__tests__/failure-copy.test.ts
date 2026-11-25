import { describe, expect, it } from 'vitest';
import { httpFallbackCopy, internalErrorMessage } from '../failure-copy.js';

// Live-found 2026-11-25: a failed page load (GET) told the operator to "check whether your change was
// saved", sending them hunting for a write that never happened. A read changed nothing and says so.
describe('server failure copy is method-aware', () => {
  it.each(['GET', 'get', 'HEAD', 'OPTIONS'])('a %s read says nothing was changed and never asks to check a saved change', (method) => {
    expect(httpFallbackCopy({ method })).toEqual({
      message: 'The server could not finish this request.',
      action: 'Nothing was changed. Try again; if it keeps failing, report the error ID.',
    });
    expect(internalErrorMessage({ method })).toBe('The server could not finish this request. Nothing was changed. Try again; if it keeps failing, copy the request ID and report this problem.');
  });

  it.each(['POST', 'put', 'PATCH', 'DELETE'])('a %s write still asks to check whether the change was saved', (method) => {
    expect(httpFallbackCopy({ method }).action).toBe('Check whether your change was saved, then try again. If it keeps failing, report the error ID.');
    expect(internalErrorMessage({ method })).toBe('The server could not finish this request. Check whether your change was saved, then copy the request ID and report this problem.');
  });
});
