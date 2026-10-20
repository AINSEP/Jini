import { describe, expect, it } from 'vitest';
import { decodeApiError } from '../errors.js';

describe('API error decoding characterization', () => {
  it.each([undefined, null, [], 'failure', 0, false, Symbol('failure'), () => 'failure'])(
    'rejects non-record bodies without reading envelope fields: %s',
    body => {
      expect(decodeApiError({ body })).toStrictEqual({ message: 'request failed' });
      expect(decodeApiError({ body }, { fallbackMessage: 'custom fallback' }))
        .toStrictEqual({ message: 'custom fallback' });
    },
  );

  it.each([undefined, null, [], 'legacy failure', 0, false, () => 'failure'])(
    'uses flat metadata when error is not a nested record: %s',
    error => {
      expect(decodeApiError({ body: {
        error, message: 'flat failure', code: 'FLAT', details: null,
        retryable: false, requestId: '',
      } })).toStrictEqual({
        message: error === 'legacy failure' ? 'legacy failure' : 'flat failure',
        code: 'FLAT', details: null, retryable: false, requestId: '',
      });
    },
  );

  it('uses nested fields exclusively even when their message is malformed', () => {
    expect(decodeApiError({ body: {
      message: 'flat failure', code: 'FLAT', details: 'flat details',
      retryable: true, requestId: 'flat request', error: { message: 42 },
    } }, { fallbackMessage: 'custom fallback' })).toStrictEqual({ message: 'custom fallback' });
  });

  it('retains nested metadata and details identity without coercion or copying', () => {
    const details = { reasons: ['permission denied'] };
    const body = { error: {
      message: 'nested failure', code: '', details, retryable: true, requestId: 'request-1',
    } };
    expect(decodeApiError({ body })).toStrictEqual({
      message: 'nested failure', code: '', details, retryable: true, requestId: 'request-1',
    });
    expect(decodeApiError({ body }).details).toBe(details);
  });

  it.each([undefined, null, 42, {}, []])('omits malformed typed metadata: %j', value => {
    expect(decodeApiError({ body: {
      error: { message: 'failure', code: value, retryable: value, requestId: value },
    } })).toStrictEqual({ message: 'failure' });
  });

  it.each([null, false, 0, '', [], { reason: 'failure' }])(
    'retains every defined details value: %j', details => {
      expect(decodeApiError({ body: { message: 'failure', details } }))
        .toStrictEqual({ message: 'failure', details });
    },
  );

  it('omits undefined details rather than emitting an undefined property', () => {
    expect(decodeApiError({ body: { message: 'failure', details: undefined } }))
      .toStrictEqual({ message: 'failure' });
  });

  it.each([{ message: '' }, { error: '', message: 'flat failure' }, { error: { message: '' } }])(
    'keeps empty string messages instead of replacing them with the fallback: %j', body => {
      expect(decodeApiError({ body }, { fallbackMessage: 'custom fallback' }))
        .toStrictEqual({ message: '' });
    },
  );

  it.each([{}, { error: {} }, { message: false }, { message: ['failure'] }])(
    'uses defaults or an explicitly empty fallback for missing string messages: %j', body => {
      expect(decodeApiError({ body }, {})).toStrictEqual({ message: 'request failed' });
      expect(decodeApiError({ body }, { fallbackMessage: undefined }))
        .toStrictEqual({ message: 'request failed' });
      expect(decodeApiError({ body }, { fallbackMessage: '' })).toStrictEqual({ message: '' });
    },
  );

  it('preserves legacy error precedence when the nested record is the body itself', () => {
    const body: Record<string, unknown> = { message: 'flat failure', code: 'SELF' };
    body.error = body;
    expect(decodeApiError({ body })).toStrictEqual({ message: 'flat failure', code: 'SELF' });
  });
});
