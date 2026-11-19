import { act, cleanup, renderHook } from '@testing-library/react';
import { formatUserFacingError } from '@jini-ai/core';
import type { FormEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRecoveryKitDownload, useOwnerPasswordReset, useRecoveryCodeSignIn, useRecoveryKit,
  type DescribeRecoveryFailure,
} from '../OwnerRecovery.hooks.js';

const t = (key: string) => key;
const copy = { mismatch: 'host mismatch', recovered: 'host recovered', reset: 'host reset' };
const safeFailure = formatUserFacingError({ message: 'safe failure', action: 'host action', step: 'test', cause: null });
const rejected = new Error('SENTINEL-SECRET');

afterEach(cleanup);

function event(): FormEvent {
  return { preventDefault: vi.fn() } as FormEvent;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('useRecoveryCodeSignIn', () => {
  it.each(['success', 'failure'])('clears all secrets after %s and stores only the described failure', async outcome => {
    const recover = vi.fn().mockImplementation(() => outcome === 'success' ? Promise.resolve() : Promise.reject(rejected));
    const describeFailure = vi.fn<DescribeRecoveryFailure>(() => safeFailure);
    const { result } = renderHook(() => useRecoveryCodeSignIn({ recover, describeFailure, t, copy }));
    act(() => {
      result.current.setCode('  one-use-code  ');
      result.current.setPassword('new-password');
      result.current.setConfirmation('new-password');
    });
    const submitEvent = event();
    await act(async () => result.current.submit(submitEvent));
    expect(submitEvent.preventDefault).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith({ code: 'one-use-code', password: 'new-password' });
    expect(result.current.code).toBe('');
    expect(result.current.password).toBe('');
    expect(result.current.confirmation).toBe('');
    expect(result.current.busy).toBe(false);
    expect(result.current.failure).toEqual(outcome === 'success' ? null : safeFailure);
    expect(result.current.message).toBe(outcome === 'success' ? copy.recovered : '');
    expect(JSON.stringify(result.current)).not.toContain('SENTINEL-SECRET');
    expect(describeFailure).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0);
    if (outcome === 'failure') expect(describeFailure).toHaveBeenCalledWith({ error: rejected, scope: 'recover' });
  });

  it('retains mismatched fields and reports the host message without a request', async () => {
    const recover = vi.fn();
    const describeFailure = vi.fn<DescribeRecoveryFailure>(() => safeFailure);
    const { result } = renderHook(() => useRecoveryCodeSignIn({ recover, describeFailure, t, copy }));
    act(() => {
      result.current.setCode('keep-code');
      result.current.setPassword('keep-password');
      result.current.setConfirmation('different');
    });
    await act(async () => result.current.submit(event()));
    expect(result.current.message).toBe(copy.mismatch);
    expect(result.current.code).toBe('keep-code');
    expect(result.current.password).toBe('keep-password');
    expect(result.current.confirmation).toBe('different');
    expect(result.current.busy).toBe(false);
    expect(result.current.failure).toBeNull();
    expect(recover).not.toHaveBeenCalled();
    expect(describeFailure).not.toHaveBeenCalled();
  });

  it('is busy and clears the previous failure and message when retrying', async () => {
    const pending = deferred<unknown>();
    const recover = vi.fn().mockRejectedValueOnce(rejected).mockImplementationOnce(() => pending.promise);
    const describeFailure = vi.fn<DescribeRecoveryFailure>(() => safeFailure);
    const { result } = renderHook(() => useRecoveryCodeSignIn({ recover, describeFailure, t, copy }));
    act(() => { result.current.setPassword('first'); result.current.setConfirmation('first'); });
    await act(async () => result.current.submit(event()));
    expect(result.current.failure).toEqual(safeFailure);
    act(() => { result.current.setPassword('retry'); result.current.setConfirmation('mismatch'); });
    await act(async () => result.current.submit(event()));
    expect(result.current.message).toBe(copy.mismatch);
    act(() => result.current.setConfirmation('retry'));
    let submission!: Promise<void>;
    act(() => { submission = result.current.submit(event()); });
    expect(result.current.busy).toBe(true);
    expect(result.current.failure).toBeNull();
    expect(result.current.message).toBe('');
    expect(result.current.password).toBe('retry');
    await act(async () => { pending.resolve(undefined); await submission; });
    expect(result.current.busy).toBe(false);
    expect(result.current.password).toBe('');
    expect(result.current.confirmation).toBe('');
    expect(result.current.message).toBe(copy.recovered);
  });

  it('clears secrets and busy even when the failure describer throws', async () => {
    const describeError = new Error('description failed');
    const recover = vi.fn().mockRejectedValue(rejected);
    const describeFailure: DescribeRecoveryFailure = () => { throw describeError; };
    const { result } = renderHook(() => useRecoveryCodeSignIn({ recover, describeFailure, t, copy }));
    act(() => {
      result.current.setCode('secret-code');
      result.current.setPassword('secret-password');
      result.current.setConfirmation('secret-password');
    });
    await act(async () => { await expect(result.current.submit(event())).rejects.toBe(describeError); });
    expect(result.current.code).toBe('');
    expect(result.current.password).toBe('');
    expect(result.current.confirmation).toBe('');
    expect(result.current.busy).toBe(false);
    expect(result.current.failure).toBeNull();
  });
});

describe('useRecoveryKit', () => {
  it.each(['success', 'failure'])('clears secrets after %s and stores only the described failure', async outcome => {
    const issue = vi.fn().mockImplementation(() => outcome === 'success' ? Promise.resolve({ codes: ['fresh'] }) : Promise.reject(rejected));
    const describeFailure = vi.fn<DescribeRecoveryFailure>(() => safeFailure);
    const { result } = renderHook(() => useRecoveryKit({ issue, describeFailure }));
    act(() => { result.current.setPassword('password'); result.current.setCode('proof'); });
    const submitEvent = event();
    await act(async () => result.current.submit(submitEvent));
    expect(submitEvent.preventDefault).toHaveBeenCalledOnce();
    expect(issue).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledWith({ password: 'password', code: 'proof' });
    expect(result.current.password).toBe('');
    expect(result.current.code).toBe('');
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toEqual(outcome === 'success' ? null : safeFailure);
    expect(result.current.codes).toEqual(outcome === 'success' ? ['fresh'] : []);
    expect(JSON.stringify(result.current)).not.toContain('SENTINEL-SECRET');
    expect(describeFailure).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0);
    if (outcome === 'failure') expect(describeFailure).toHaveBeenCalledWith({ error: rejected, scope: 'issue' });
  });

  it.each(['', 'proof'])('omits the code key only when the field is empty (%j)', async code => {
    const issue = vi.fn().mockResolvedValue({ codes: [] });
    const describeFailure: DescribeRecoveryFailure = () => safeFailure;
    const { result } = renderHook(() => useRecoveryKit({ issue, describeFailure }));
    act(() => { result.current.setPassword('password'); result.current.setCode(code); });
    await act(async () => result.current.submit(event()));
    expect(issue).toHaveBeenCalledTimes(1);
    const input = issue.mock.calls[0]![0];
    expect(Object.keys(input)).toEqual(code ? ['password', 'code'] : ['password']);
    expect(input).toEqual(code ? { password: 'password', code } : { password: 'password' });
  });

  it('clears prior codes and errors at the start and remains busy until the new issue finishes', async () => {
    const pending = deferred<{ codes: string[] }>();
    const issue = vi.fn().mockRejectedValueOnce(rejected).mockImplementationOnce(() => pending.promise);
    const describeFailure: DescribeRecoveryFailure = () => safeFailure;
    const { result } = renderHook(() => useRecoveryKit({ issue, describeFailure }));
    await act(async () => result.current.submit(event()));
    expect(result.current.error).toEqual(safeFailure);
    act(() => {
      result.current.setCodes(['old-code']);
      result.current.setPassword('retry-password');
      result.current.setCode('retry-proof');
    });
    expect(result.current.codes).toEqual(['old-code']);
    let submission!: Promise<void>;
    act(() => { submission = result.current.submit(event()); });
    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.codes).toEqual([]);
    expect(result.current.password).toBe('retry-password');
    expect(result.current.code).toBe('retry-proof');
    await act(async () => { pending.resolve({ codes: ['new-code'] }); await submission; });
    expect(result.current.busy).toBe(false);
    expect(result.current.codes).toEqual(['new-code']);
    expect(result.current.password).toBe('');
    expect(result.current.code).toBe('');
  });

  it('clears secrets and busy even when the failure describer throws', async () => {
    const describeError = new Error('description failed');
    const issue = vi.fn().mockRejectedValue(rejected);
    const describeFailure: DescribeRecoveryFailure = () => { throw describeError; };
    const { result } = renderHook(() => useRecoveryKit({ issue, describeFailure }));
    act(() => { result.current.setPassword('secret-password'); result.current.setCode('secret-code'); });
    await act(async () => { await expect(result.current.submit(event())).rejects.toBe(describeError); });
    expect(result.current.password).toBe('');
    expect(result.current.code).toBe('');
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe('useOwnerPasswordReset', () => {
  it.each(['success', 'failure'])('clears secrets after %s and stores only the described failure', async outcome => {
    const reset = vi.fn().mockImplementation(() => outcome === 'success' ? Promise.resolve() : Promise.reject(rejected));
    const describeFailure = vi.fn<DescribeRecoveryFailure>(() => safeFailure);
    const { result } = renderHook(() => useOwnerPasswordReset({ reset, describeFailure, t, copy }));
    act(() => { result.current.setPassword('new-password'); result.current.setConfirmation('new-password'); });
    const submitEvent = event();
    await act(async () => result.current.submit(submitEvent));
    expect(submitEvent.preventDefault).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith({ password: 'new-password' });
    expect(result.current.password).toBe('');
    expect(result.current.confirmation).toBe('');
    expect(result.current.busy).toBe(false);
    expect(result.current.failure).toEqual(outcome === 'success' ? null : safeFailure);
    expect(result.current.message).toBe(outcome === 'success' ? copy.reset : '');
    expect(JSON.stringify(result.current)).not.toContain('SENTINEL-SECRET');
    expect(describeFailure).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0);
    if (outcome === 'failure') expect(describeFailure).toHaveBeenCalledWith({ error: rejected, scope: 'reset' });
  });

  it('retains mismatched fields and reports the host message without a request', async () => {
    const reset = vi.fn();
    const describeFailure = vi.fn<DescribeRecoveryFailure>(() => safeFailure);
    const { result } = renderHook(() => useOwnerPasswordReset({ reset, describeFailure, t, copy }));
    act(() => { result.current.setPassword('keep-password'); result.current.setConfirmation('different'); });
    await act(async () => result.current.submit(event()));
    expect(result.current.message).toBe(copy.mismatch);
    expect(result.current.password).toBe('keep-password');
    expect(result.current.confirmation).toBe('different');
    expect(result.current.busy).toBe(false);
    expect(result.current.failure).toBeNull();
    expect(reset).not.toHaveBeenCalled();
    expect(describeFailure).not.toHaveBeenCalled();
  });

  it('is busy and clears the previous failure and message when retrying', async () => {
    const pending = deferred<unknown>();
    const reset = vi.fn().mockRejectedValueOnce(rejected).mockImplementationOnce(() => pending.promise);
    const describeFailure: DescribeRecoveryFailure = () => safeFailure;
    const { result } = renderHook(() => useOwnerPasswordReset({ reset, describeFailure, t, copy }));
    act(() => { result.current.setPassword('first'); result.current.setConfirmation('first'); });
    await act(async () => result.current.submit(event()));
    expect(result.current.failure).toEqual(safeFailure);
    act(() => { result.current.setPassword('retry'); result.current.setConfirmation('mismatch'); });
    await act(async () => result.current.submit(event()));
    expect(result.current.message).toBe(copy.mismatch);
    act(() => result.current.setConfirmation('retry'));
    let submission!: Promise<void>;
    act(() => { submission = result.current.submit(event()); });
    expect(result.current.busy).toBe(true);
    expect(result.current.failure).toBeNull();
    expect(result.current.message).toBe('');
    expect(result.current.password).toBe('retry');
    await act(async () => { pending.resolve(undefined); await submission; });
    expect(result.current.busy).toBe(false);
    expect(result.current.password).toBe('');
    expect(result.current.confirmation).toBe('');
    expect(result.current.message).toBe(copy.reset);
  });

  it('clears secrets and busy even when the failure describer throws', async () => {
    const describeError = new Error('description failed');
    const reset = vi.fn().mockRejectedValue(rejected);
    const describeFailure: DescribeRecoveryFailure = () => { throw describeError; };
    const { result } = renderHook(() => useOwnerPasswordReset({ reset, describeFailure, t, copy }));
    act(() => { result.current.setPassword('secret-password'); result.current.setConfirmation('secret-password'); });
    await act(async () => { await expect(result.current.submit(event())).rejects.toBe(describeError); });
    expect(result.current.password).toBe('');
    expect(result.current.confirmation).toBe('');
    expect(result.current.busy).toBe(false);
    expect(result.current.failure).toBeNull();
  });
});

describe('createRecoveryKitDownload', () => {
  it('saves joined codes with a trailing newline under the host filename before dismissing once', () => {
    const calls: string[] = [];
    const saveTextFile = vi.fn(() => { calls.push('save'); });
    const dismiss = vi.fn(() => { calls.push('dismiss'); });
    const download = createRecoveryKitDownload({ codes: ['alpha', 'beta'], filename: 'host-kit.txt', saveTextFile, dismiss });
    expect(saveTextFile).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    download();
    expect(saveTextFile).toHaveBeenCalledTimes(1);
    expect(saveTextFile).toHaveBeenCalledWith({ text: 'alpha\nbeta\n', filename: 'host-kit.txt' });
    expect(dismiss).toHaveBeenCalledOnce();
    expect(calls).toEqual(['save', 'dismiss']);
  });
});
