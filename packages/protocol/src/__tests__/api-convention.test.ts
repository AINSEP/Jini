import { describe, expect, it } from 'vitest';
import {
  createApiError,
  createApiErrorResponse,
  decodeRunContextRef,
  encodeRunContextRef,
  isTerminalRunState,
  RUN_STATES,
} from '../index.js';

describe('required arguments and optional arguments', () => {
  it('keeps the exact error payload with optional metadata in the second object', () => {
    const error = createApiError(
      { code: 'PACK_SPECIFIC', message: 'try again' },
      { details: { attempt: 2 }, retryable: true, requestId: 'req_1' },
    );
    expect(error).toEqual({
      code: 'PACK_SPECIFIC', message: 'try again',
      details: { attempt: 2 }, retryable: true, requestId: 'req_1',
    });
    expect(createApiErrorResponse({ error })).toEqual({ error });
    expect(createApiErrorResponse({ error }).error).toBe(error);
    expect(createApiError({ code: 'NOT_FOUND', message: 'gone' })).toEqual({
      code: 'NOT_FOUND', message: 'gone',
    });
  });

  it('preserves context bytes and payload field order through the required payload object', () => {
    const payload = { history: [], prompt: '' };
    const contextRef = encodeRunContextRef({ payload });
    expect(contextRef).toBe('jini-run-context:v1:{"history":[],"prompt":""}');
    expect(decodeRunContextRef({ contextRef })).toEqual(payload);
  });

  it('classifies every wire run state using the required state object', () => {
    expect(RUN_STATES.map((state) => isTerminalRunState({ state }))).toEqual([
      false, false, false, true, true, true,
    ]);
  });
});
