import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useA2uiSurfaceRoot } from '../use-a2ui-surface.js';
import type { A2uiInterpreter, ComponentInstance } from '../protocol.js';

function makeInterpreter(initialRoot: ComponentInstance | undefined): { interpreter: A2uiInterpreter; setRoot: (r: ComponentInstance | undefined) => void; notify: () => void } {
  let root = initialRoot;
  const listeners = new Set<() => void>();
  const interpreter: A2uiInterpreter = {
    applyAgentMessage: vi.fn(),
    getSurface: vi.fn(),
    listSurfaceIds: vi.fn(() => []),
    getRoot: (surfaceId) => (surfaceId === 's1' ? root : undefined),
    buildAction: vi.fn(),
    resolve: vi.fn(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    interpreter,
    setRoot: (r) => { root = r; },
    notify: () => { for (const l of listeners) l(); },
  };
}

describe('useA2uiSurfaceRoot', () => {
  it('returns undefined when the surface has no root yet', () => {
    const { interpreter } = makeInterpreter(undefined);
    const { result } = renderHook(() => useA2uiSurfaceRoot(interpreter, 's1'));
    expect(result.current).toBeUndefined();
  });

  it('returns the current root component', () => {
    const rootComponent: ComponentInstance = { id: 'root', component: 'native.data-table', props: {} };
    const { interpreter } = makeInterpreter(rootComponent);
    const { result } = renderHook(() => useA2uiSurfaceRoot(interpreter, 's1'));
    expect(result.current).toBe(rootComponent);
  });

  it('re-renders with the new root after the interpreter notifies', () => {
    const first: ComponentInstance = { id: 'root', component: 'native.data-table', props: {} };
    const second: ComponentInstance = { id: 'root', component: 'native.data-table', props: { rows: [] } };
    const { interpreter, setRoot, notify } = makeInterpreter(first);
    const { result } = renderHook(() => useA2uiSurfaceRoot(interpreter, 's1'));
    expect(result.current).toBe(first);
    act(() => {
      setRoot(second);
      notify();
    });
    expect(result.current).toBe(second);
  });

  it('unsubscribes on unmount', () => {
    const { interpreter } = makeInterpreter(undefined);
    const unsubscribe = vi.fn();
    const subscribeSpy = vi.spyOn(interpreter, 'subscribe').mockReturnValue(unsubscribe);
    const { unmount } = renderHook(() => useA2uiSurfaceRoot(interpreter, 's1'));
    expect(subscribeSpy).toHaveBeenCalled();
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
