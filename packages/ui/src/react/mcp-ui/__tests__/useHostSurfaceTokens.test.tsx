import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useHostSurfaceTokens } from '../useHostSurfaceTokens.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('useHostSurfaceTokens', () => {
  it('resolves to an empty token set when the surface element is not mounted', () => {
    // A stable ref, as a component's useRef would be: the hook re-subscribes when the ref changes.
    const ref = { current: null };
    const { result } = renderHook(() => useHostSurfaceTokens(ref));
    expect(result.current).toEqual({});
  });

  it('keeps the same token object when an ancestor theme attribute changes without changing the tokens', async () => {
    const host = document.createElement('div');
    const surface = document.createElement('div');
    host.appendChild(surface);
    document.body.appendChild(host);
    const ref = { current: surface };
    const { result } = renderHook(() => useHostSurfaceTokens(ref));
    const first = result.current;
    expect(first).toEqual({});

    await act(async () => {
      host.setAttribute('data-theme', 'dark');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current).toBe(first);
  });
});
