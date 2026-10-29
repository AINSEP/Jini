import { describe, expect, it, vi } from 'vitest';
import { createBrowserTelemetry, installBrowserErrorListeners, type BrowserTelemetryPayload } from '../telemetry.js';

describe('browser telemetry boundaries', () => {
  it('uses safe type labels and error names when no message or stack is available', () => {
    const sent: BrowserTelemetryPayload[] = [];
    const telemetry = createBrowserTelemetry({ send: async event => { sent.push(event); }, nowMs: () => 0,
      setTimer: () => 1, clearTimer() {} });
    telemetry.setSignedIn(true);
    const error = new TypeError('');
    delete error.stack;
    telemetry.reportError({ error });
    telemetry.reportError({ error: 'literal failure', componentStack: '' });
    telemetry.reportError({ error: null });
    telemetry.reportError({ error: undefined });
    expect(sent).toEqual([
      { type: 'error', message: 'TypeError', stack: '', route: '' },
      { type: 'error', message: 'literal failure', stack: '', route: '' },
      { type: 'error', message: 'Non-Error thrown (null)', stack: '', route: '' },
      { type: 'error', message: 'Non-Error thrown (undefined)', stack: '', route: '' },
    ]);
  });

  it('expires fingerprints at five minutes and evicts the oldest at the bounded capacity', () => {
    const sent: BrowserTelemetryPayload[] = [];
    let now = 0;
    const telemetry = createBrowserTelemetry({ send: async event => { sent.push(event); }, nowMs: () => now,
      setTimer: () => 1, clearTimer() {} }, { maxErrorsPerMinute: 500 });
    telemetry.setSignedIn(true);
    for (let i = 0; i <= 200; i++) telemetry.reportError({ error: `failure ${i}` });
    telemetry.reportError({ error: 'failure 0' });
    expect(sent).toHaveLength(202);
    expect(sent.at(-1)).toEqual({ type: 'error', message: 'failure 0', stack: '', route: '' });
    telemetry.reportError({ error: 'failure 200' });
    expect(sent).toHaveLength(202);
    now = 300_000;
    telemetry.reportError({ error: 'failure 200' });
    expect(sent).toHaveLength(203);
    expect(sent.at(-1)).toEqual({ type: 'error', message: 'failure 200', stack: '', route: '' });
  });

  it('allows the same page to be reported after signing out and signing back in', () => {
    const sent: BrowserTelemetryPayload[] = [];
    const pending = new Map<number, () => void>();
    let id = 0;
    const telemetry = createBrowserTelemetry({ send: async event => { sent.push(event); }, nowMs: () => 0,
      setTimer: fn => { pending.set(++id, fn); return id; }, clearTimer: handle => { pending.delete(handle as number); },
    }, { pageviewDelayMs: 25 });
    const flush = () => { for (const [key, fn] of pending) { pending.delete(key); fn(); } };
    telemetry.setSignedIn(true);
    telemetry.setRoute('/old');
    telemetry.setRoute('/' + 'a'.repeat(220));
    flush();
    telemetry.setSignedIn(false);
    telemetry.setSignedIn(true);
    telemetry.setRoute('/' + 'a'.repeat(220));
    flush();
    expect(sent).toEqual([
      { type: 'pageview', route: '/' + 'a'.repeat(199) },
      { type: 'pageview', route: '/' + 'a'.repeat(199) },
    ]);
  });

  it('contains clock failures without delivering partial error reports', () => {
    const send = vi.fn(async () => {});
    const telemetry = createBrowserTelemetry({ send, nowMs: () => { throw new Error('clock unavailable'); },
      setTimer: () => 1, clearTimer() {} });
    telemetry.setSignedIn(true);
    expect(() => telemetry.reportError({ error: 'failed' })).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});

it('installs both browser listeners, skips opaque cross-origin errors and removes the same listeners', () => {
  const listeners = new Map<string, EventListener>();
  const target = {
    addEventListener: (name: string, listener: EventListener) => { listeners.set(name, listener); },
    removeEventListener: (name: string, listener: EventListener) => {
      expect(listeners.get(name)).toBe(listener);
      listeners.delete(name);
    },
  };
  const reportError = vi.fn();
  const uninstall = installBrowserErrorListeners({ target: target as never, telemetry: { reportError } });
  expect([...listeners.keys()]).toEqual(['error', 'unhandledrejection']);
  const error = new Error('visible failure');
  listeners.get('error')!({ error: null } as unknown as Event);
  listeners.get('error')!({ error: undefined } as unknown as Event);
  expect(reportError).not.toHaveBeenCalled();
  listeners.get('error')!({ error } as unknown as Event);
  listeners.get('unhandledrejection')!({ reason: 'rejected' } as unknown as Event);
  expect(reportError.mock.calls).toEqual([[{ error }], [{ error: 'rejected' }]]);
  uninstall();
  expect(listeners.size).toBe(0);
});
