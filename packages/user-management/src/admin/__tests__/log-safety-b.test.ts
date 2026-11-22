import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '@jini-ai/core/admin-runtime';
import { createAuthController } from '../controllers/auth.controller.js';
import { PeopleApiError } from '../ports.js';

afterEach(() => vi.restoreAllMocks());
describe('sheet B login rejection', () => {
  it.each([new Error('SENTINEL_PRIVATE_LOGIN'), 'SENTINEL_PRIVATE_LOGIN'])('uses login failed for unknown failures', async failure => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onLogin = vi.fn();
    const controller = createAuthController({ api: { login: () => Promise.reject(failure) }, onLogin });
    expect(await controller.submit({})).toBe(false);
    expect(controller.getSnapshot({})).toMatchObject({ error: 'login failed', busy: false });
    expect(onLogin).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(' ')).not.toContain('SENTINEL_PRIVATE_LOGIN');
    controller.dispose({});
  });
  it.each([new AdminApiError({ message: 'Approved login copy', status: 401 }), new PeopleApiError({ message: 'Approved login copy', code: 'UNAUTHENTICATED' })])('retains typed API copy', async failure => {
    const controller = createAuthController({ api: { login: () => Promise.reject(failure) }, onLogin: vi.fn() });
    expect(await controller.submit({})).toBe(false);
    expect(controller.getSnapshot({}).error).toBe('Approved login copy');
    controller.dispose({});
  });
});
