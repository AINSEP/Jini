import { describe, expect, it } from 'vitest';
import { validationError, type ServerValidationIssue } from '../api-error.js';

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
