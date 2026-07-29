import { describe, expect, it } from 'vitest';
import { rawInput, validationError } from '../request.js';

describe('rawInput', () => {
  it('extracts body/query/params from a full Express request', () => {
    const req = { body: { a: 1 }, query: { q: '1' }, params: { id: '42' } } as any;
    expect(rawInput(req)).toEqual({ body: { a: 1 }, query: { q: '1' }, params: { id: '42' } });
  });

  it('defaults query and params to {} when Express omits them', () => {
    const req = { body: undefined, query: undefined, params: undefined } as any;
    expect(rawInput(req)).toEqual({ body: undefined, query: {}, params: {} });
  });
});

describe('validationError', () => {
  it('builds a plain BAD_REQUEST error when no issues are given', () => {
    expect(validationError('name is required')).toEqual({
      code: 'BAD_REQUEST',
      message: 'name is required',
    });
  });

  it('attaches structured validation issues when given', () => {
    const issues = [{ path: 'name', message: 'required' }];
    const error = validationError('validation failed', issues);
    expect(error).toEqual({
      code: 'BAD_REQUEST',
      message: 'validation failed',
      details: { kind: 'validation', issues },
    });
  });
});
