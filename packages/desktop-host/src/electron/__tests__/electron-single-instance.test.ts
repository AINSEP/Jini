import { describe, expect, it, vi } from 'vitest';
import { createElectronSingleInstanceLockPort } from '../electron-single-instance.js';
import { createFakeElectronApp } from '../testing.js';

describe('createElectronSingleInstanceLockPort', () => {
  it('defaults the fake app to granting the lock when no options are given', () => {
    const app = createFakeElectronApp({});
    const port = createElectronSingleInstanceLockPort({ app });
    expect(port.claim({ onSecondInstance: vi.fn() })).toBe(true);
    expect(app.quitCalled).toBe(false);
  });

  it('claims the lock and forwards second-instance notifications', () => {
    const app = createFakeElectronApp({}, { lockGranted: true });
    const port = createElectronSingleInstanceLockPort({ app });
    const onSecondInstance = vi.fn();
    expect(port.claim({ onSecondInstance })).toBe(true);
    app.emitSecondInstance();
    expect(onSecondInstance).toHaveBeenCalledTimes(1);
  });

  it('quits and returns false when another instance already holds the lock', () => {
    const app = createFakeElectronApp({}, { lockGranted: false });
    const port = createElectronSingleInstanceLockPort({ app });
    expect(port.claim({ onSecondInstance: vi.fn() })).toBe(false);
    expect(app.quitCalled).toBe(true);
  });
});
