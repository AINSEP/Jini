import { describe, expect, it, vi } from 'vitest';
import { readInitialSession } from '../read-initial.js';

describe('readInitialSession', () => {
  it('keeps an existing identity without bootstrap or notification', async () => {
    const session = { id: 'existing' };
    const me = vi.fn(async () => session);
    const bootstrap = vi.fn(async () => undefined);
    const admit = vi.fn(() => true);
    const isUnauthenticated = vi.fn(() => false);
    const onBootstrapped = vi.fn();
    expect(await readInitialSession({ me, bootstrap, admit, isUnauthenticated }, { onBootstrapped })).toBe(session);
    expect(me).toHaveBeenCalledTimes(1);
    expect(me).toHaveBeenCalledWith({});
    expect(bootstrap).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(isUnauthenticated).not.toHaveBeenCalled();
    expect(onBootstrapped).not.toHaveBeenCalled();
  });

  it.each(['service failure', 'unclassified refusal', 'network failure'])(
    'propagates %s without attempting bootstrap', async (message) => {
      const error = new Error(message);
      const me = vi.fn(async () => { throw error; });
      const bootstrap = vi.fn(async () => undefined);
      const admit = vi.fn(() => true);
      const isUnauthenticated = vi.fn(() => false);
      await expect(readInitialSession({ me, bootstrap, admit, isUnauthenticated })).rejects.toBe(error);
      expect(me).toHaveBeenCalledTimes(1);
      expect(isUnauthenticated).toHaveBeenCalledTimes(1);
      expect(isUnauthenticated).toHaveBeenCalledWith({ error });
      expect(admit).not.toHaveBeenCalled();
      expect(bootstrap).not.toHaveBeenCalled();
    },
  );

  it('preserves the original unauthenticated error when admission refuses', async () => {
    const error = new Error('no session');
    const me = vi.fn(async () => { throw error; });
    const bootstrap = vi.fn(async () => undefined);
    const admit = vi.fn(() => false);
    const onBootstrapped = vi.fn();
    await expect(readInitialSession({ me, bootstrap, admit, isUnauthenticated: () => true }, { onBootstrapped })).rejects.toBe(error);
    expect(admit).toHaveBeenCalledTimes(1);
    expect(admit).toHaveBeenCalledWith({});
    expect(me).toHaveBeenCalledTimes(1);
    expect(bootstrap).not.toHaveBeenCalled();
    expect(onBootstrapped).not.toHaveBeenCalled();
  });

  it('hands a refused bootstrap\'s own error to onBootstrapFailed and still rethrows the original', async () => {
    const error = new Error('no session');
    const refusal = new Error('bootstrap refused');
    const me = vi.fn(async () => { throw error; });
    const bootstrap = vi.fn(async () => { throw refusal; });
    const onBootstrapFailed = vi.fn();
    await expect(readInitialSession({ me, bootstrap, admit: () => true, isUnauthenticated: () => true }, { onBootstrapFailed })).rejects.toBe(error);
    expect(onBootstrapFailed).toHaveBeenCalledWith({ error: refusal });
  });

  it('never retries or reads identity after a refused bootstrap', async () => {
    const error = new Error('no session');
    const me = vi.fn(async () => { throw error; });
    const bootstrap = vi.fn(async () => { throw new Error('bootstrap refused'); });
    const onBootstrapped = vi.fn();
    await expect(readInitialSession({ me, bootstrap, admit: () => true, isUnauthenticated: () => true }, { onBootstrapped })).rejects.toBe(error);
    expect(me).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledWith({});
    expect(onBootstrapped).not.toHaveBeenCalled();
  });

  it('preserves the first error when the post-bootstrap identity read fails', async () => {
    const error = new Error('no session');
    const me = vi.fn(async () => { throw error; })
      .mockRejectedValueOnce(error).mockRejectedValueOnce(new Error('identity unavailable'));
    const bootstrap = vi.fn(async () => undefined);
    const onBootstrapped = vi.fn();
    await expect(readInitialSession({ me, bootstrap, admit: () => true, isUnauthenticated: () => true }, { onBootstrapped })).rejects.toBe(error);
    expect(me).toHaveBeenCalledTimes(2);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(onBootstrapped).not.toHaveBeenCalled();
  });

  it('returns the second identity and notifies exactly once after reading it', async () => {
    const calls: string[] = [];
    const session = { id: 'bootstrapped', permissions: ['content.write'] };
    const error = new Error('no session');
    const me = vi.fn(async (required: Record<string, never>) => {
      expect(required).toEqual({});
      calls.push('me');
      if (calls.length === 1) throw error;
      calls.push('identity read');
      return session;
    });
    const bootstrap = vi.fn(async (required: Record<string, never>) => {
      expect(required).toEqual({});
      calls.push('bootstrap');
    });
    const onBootstrapped = vi.fn(() => { calls.push('notified'); });
    expect(await readInitialSession({ me, bootstrap, admit: () => true, isUnauthenticated: () => true }, { onBootstrapped })).toBe(session);
    expect(calls).toEqual(['me', 'bootstrap', 'me', 'identity read', 'notified']);
    expect(me).toHaveBeenCalledTimes(2);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(onBootstrapped).toHaveBeenCalledTimes(1);
  });

  it('returns the bootstrapped identity when no notification is supplied', async () => {
    const session = { id: 'session' };
    const me = vi.fn(async () => session).mockRejectedValueOnce(new Error('no session'));
    const bootstrap = vi.fn(async () => undefined);
    expect(await readInitialSession({ me, bootstrap, admit: () => true, isUnauthenticated: () => true })).toBe(session);
    expect(me).toHaveBeenCalledTimes(2);
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });
});
