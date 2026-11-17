import { describe, expect, it } from 'vitest';
import { statusForError, validationError, type ServerValidationIssue } from '../api-error.js';

describe('validationError', () => {
  it('builds a bare BAD_REQUEST with no details key when there are no issues', () => {
    const error = validationError({ message: 'bad' });
    expect(error).toEqual({ code: 'BAD_REQUEST', message: 'bad' });
    expect('details' in error).toBe(false);
  });
  it('attaches validation details for a non-empty issue list, readonly arrays included', () => {
    const issues: readonly ServerValidationIssue[] = [{ path: 'a.b', message: 'required' }];
    expect(validationError({ message: 'bad' }, { issues }).details).toEqual({ kind: 'validation', issues: [{ path: 'a.b', message: 'required' }] });
  });
});

describe('statusForError', () => {
  it('answers 404 for UNKNOWN_TOOL, the same status as a missing run but a different code', () => {
    expect(statusForError({ error: { code: 'UNKNOWN_TOOL', message: 'x' } })).toBe(404);
    expect(statusForError({ error: { code: 'NOT_FOUND', message: 'x' } })).toBe(404);
  });
  it('keeps 403 for TOOL_OPERATION_DENIED', () => {
    expect(statusForError({ error: { code: 'TOOL_OPERATION_DENIED', message: 'x' } })).toBe(403);
  });
});
