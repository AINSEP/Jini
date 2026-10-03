import { describe, expect, it, vi } from 'vitest';
import { createCompatApiError, createCompatApiErrorResponse } from '../compat.js';
import { sendApiError } from '../response.js';

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe('createCompatApiError', () => {
  it('builds an ApiError from code + message with no extra init', () => {
    expect(createCompatApiError({ code: 'NOT_FOUND', message: 'run not found' })).toEqual({
      code: 'NOT_FOUND',
      message: 'run not found',
    });
  });

  it('merges an explicit init object onto the error', () => {
    expect(
      createCompatApiError({ code: 'VALIDATION_FAILED', message: 'bad input' }, {
        details: { kind: 'validation', issues: [] } as any,
      }),
    ).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'bad input',
      details: { kind: 'validation', issues: [] },
    });
  });
});

describe('createCompatApiErrorResponse', () => {
  it('wraps the built error in the standard { error } envelope', () => {
    expect(createCompatApiErrorResponse({ code: 'BAD_REQUEST', message: 'nope' })).toEqual({
      error: { code: 'BAD_REQUEST', message: 'nope' },
    });
  });
});

describe('sendApiError (canonical error-object call shape)', () => {
  it('writes the status and the wrapped error built from separate arguments', () => {
    const res = makeRes();
    sendApiError({ res: res as any, status: 404, error: createCompatApiError({ code: 'NOT_FOUND', message: 'run not found' }) });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'run not found' },
    });
  });

  it('passes an explicit init object through to the sent error', () => {
    const res = makeRes();
    sendApiError({ res: res as any, status: 422, error: createCompatApiError({ code: 'VALIDATION_FAILED', message: 'bad input' }, {
      details: { kind: 'validation', issues: [{ path: 'name', message: 'required' }] } as any,
    }) });
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'bad input',
        details: { kind: 'validation', issues: [{ path: 'name', message: 'required' }] },
      },
    });
  });
});
