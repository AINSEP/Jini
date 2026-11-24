/**
 * @file Test support for the conversations and bridged-chat suites, which were written against a
 * `node:test`-style context (`t.after`, `t.mock.method`). This maps that context onto vitest so the
 * cases and their assertions stay exactly as authored, and supplies the small render/settle helpers
 * they share.
 */
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { onTestFinished, test as vitestTest, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export interface TestContext {
  after: (fn: () => void) => void;
  mock: { method: (obj: object, name: string, impl?: (...args: never[]) => unknown) => { mock: { callCount: () => number } } };
}

function context(): TestContext {
  return {
    after: (fn) => onTestFinished(() => { fn(); }),
    mock: {
      method: (obj, name, impl) => {
        const spy = vi.spyOn(obj as Record<string, () => unknown>, name);
        if (impl) spy.mockImplementation(impl as () => unknown);
        onTestFinished(() => { spy.mockRestore(); });
        return { mock: { callCount: () => spy.mock.calls.length } };
      },
    },
  };
}

/** `node:test`'s `test(name, (t) => …)` on vitest. */
export function test(name: string, fn: (t: TestContext) => unknown): void {
  vitestTest(name, () => fn(context()) as Promise<void> | void);
}

/** The jsdom window vitest already installed for `src/react/**`. */
export function installDom(): Window & typeof globalThis {
  return window;
}

export interface RenderedHook<T> {
  current: () => T;
  rerender: () => void;
  unmount: () => void;
}

/** Renders `useHook` in a probe component; unmounts when the test finishes. */
export function renderHookWithView<T>(
  t: TestContext,
  useHook: () => T,
  view: (value: T) => ReactNode = () => null,
): RenderedHook<T> {
  let latest!: T;
  function Probe() { latest = useHook(); return view(latest); }
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  let mounted = true;
  const unmount = () => { if (mounted) { mounted = false; act(() => root.unmount()); } };
  t.after(unmount);
  act(() => root.render(createElement(Probe)));
  return { current: () => latest, rerender: () => act(() => root.render(createElement(Probe))), unmount };
}

/** Lets pending promise callbacks run several rounds deep, inside `act`. */
export async function settle(): Promise<void> {
  await act(async () => { for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve)); });
}

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
