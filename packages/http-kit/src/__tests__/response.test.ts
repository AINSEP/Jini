import { describe, expect, it, vi } from 'vitest';
import { sendApiError, sendJson, statusForError } from '../response.js';

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

describe('sendJson', () => {
  it('writes the given status and body', () => {
    const res = makeRes();
    sendJson(res as any, 201, { id: 1 });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 1 });
  });
});

describe('sendApiError', () => {
  it('writes the given status and the error wrapped in the standard envelope', () => {
    const res = makeRes();
    sendApiError(res as any, 404, { code: 'NOT_FOUND', message: 'gone' });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'gone' } });
  });
});

describe('statusForError', () => {
  it('resolves the mapped status for a known generic error code', () => {
    expect(statusForError({ code: 'NOT_FOUND', message: 'x' })).toBe(404);
    expect(statusForError({ code: 'FORBIDDEN', message: 'x' })).toBe(403);
    expect(statusForError({ code: 'TOOL_TOKEN_MISSING', message: 'x' })).toBe(401);
    expect(statusForError({ code: 'TOOL_NOT_AVAILABLE', message: 'x' })).toBe(503);
  });

  it('falls back to 500 for a code with no explicit mapping (e.g. a pack-defined code)', () => {
    expect(statusForError({ code: 'SOME_PACK_SPECIFIC_ERROR', message: 'x' })).toBe(500);
  });
});
