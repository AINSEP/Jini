import { describe, expect, it, vi } from 'vitest';
import { claimSingleInstanceLock, type SingleInstanceApp } from '../single-instance.js';

function fakeApp(lockGranted: boolean): SingleInstanceApp & { quitCalled: boolean; secondInstanceListener: (() => void) | null } {
  const app = {
    quitCalled: false,
    secondInstanceListener: null as (() => void) | null,
    requestSingleInstanceLock: () => lockGranted,
    quit() {
      app.quitCalled = true;
    },
    onSecondInstance({ listener }: { listener: () => void }) {
      app.secondInstanceListener = listener;
    },
  };
  return app;
}

describe('claimSingleInstanceLock', () => {
  it('quits and returns false when the lock is already held', () => {
    const app = fakeApp(false);
    const onSecondInstance = vi.fn();
    expect(claimSingleInstanceLock({ app, onSecondInstance })).toBe(false);
    expect(app.quitCalled).toBe(true);
    expect(app.secondInstanceListener).toBeNull();
  });

  it('registers the second-instance listener and returns true when the lock is granted', () => {
    const app = fakeApp(true);
    const onSecondInstance = vi.fn();
    expect(claimSingleInstanceLock({ app, onSecondInstance })).toBe(true);
    expect(app.quitCalled).toBe(false);
    app.secondInstanceListener?.();
    expect(onSecondInstance).toHaveBeenCalledTimes(1);
  });
});
