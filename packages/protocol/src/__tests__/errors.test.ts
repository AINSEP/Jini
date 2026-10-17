import { describe, expect, it } from 'vitest';
import { decodeApiError } from '../errors.js';

describe('compatible API error decoding', () => {
  it('preserves a canonical message, code and metadata over conflicting legacy fields', () => {
    expect(decodeApiError({ body: { code: 'OLD', error: { code: 'FORBIDDEN', message: 'permission required', details: { permission: 'read' }, retryable: false, requestId: 'req-1' } } })).toEqual({
      code: 'FORBIDDEN', message: 'permission required', details: { permission: 'read' }, retryable: false, requestId: 'req-1',
    });
  });
  it('preserves legacy session-invalidity codes and domain metadata', () => {
    expect(decodeApiError({ body: { error: 'sign in', code: 'UNAUTHENTICATED', details: { reason: 'expired' } } })).toEqual({ message: 'sign in', code: 'UNAUTHENTICATED', details: { reason: 'expired' } });
  });
  it.each([null, [], 42, 'bad', {}, { error: {} }, { error: ['bad'] }, { error: { message: 42 } }])('uses caller fallback for malformed messages: %j', body => {
    expect(decodeApiError({ body }, { fallbackMessage: 'request failed (500)' }).message).toBe('request failed (500)');
  });
});
