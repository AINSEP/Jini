import { describe, expect, it, vi } from 'vitest';
import { AdminApiError, describeApiError } from '../admin-api-error.js';

describe('describeApiError', () => {
  it('prefers the server message', () => {
    expect(describeApiError({ e: new AdminApiError({ message: 'server said no', status: 400 }), fallback: 'fallback' })).toBe('server said no');
  });

  it('falls back when the server message is empty', () => {
    expect(describeApiError({ e: new AdminApiError({ message: '', status: 400 }), fallback: 'fallback' })).toBe('fallback');
  });

  it('never shows a plain Error message: only an AdminApiError carries approved copy', () => {
    const warn = vi.fn();
    expect(describeApiError({ e: new Error('credential: PRIVATEVALUE'), fallback: 'fallback' }, { warn })).toBe('fallback');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe('[admin] fallback Cause: Error');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATEVALUE');
  });

  it('falls back for a thrown non-Error and logs only its type', () => {
    const warn = vi.fn();
    expect(describeApiError({ e: 'a string PRIVATEVALUE', fallback: 'fallback' }, { warn })).toBe('fallback');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATEVALUE');
  });

  it('does not log an AdminApiError: the host API port already reported it', () => {
    const warn = vi.fn();
    describeApiError({ e: new AdminApiError({ message: 'server said no', status: 400 }), fallback: 'fallback' }, { warn });
    expect(warn).not.toHaveBeenCalled();
  });
});
