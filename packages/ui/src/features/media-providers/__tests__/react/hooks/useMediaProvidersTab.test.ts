import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeMediaProvidersPort } from '@jini-ai/ui-core';
import type { MediaProviderMap, MediaProvidersPort } from '@jini-ai/ui-core';
import { useMediaProvidersTab } from '../../../react/hooks/useMediaProvidersTab.js';

/**
 * @file Reconciliation coverage for `useMediaProvidersTab`'s async edges. The
 * canonical bug this guards against: a daemon that could not be reached
 * (`fetchMediaProviders` resolving `null`) must never be treated the same as
 * a daemon that answered with nothing (`{}`) — the former must leave local
 * state exactly as it was, the latter is a real answer that can drop stale
 * local markers. See `mergeDaemonProviders`'s own doc comment in ui-core for
 * the full rule this hook must not violate.
 */

describe('useMediaProvidersTab — initial load', () => {
  it('starts loading and reconciles against the daemon result', async () => {
    const port = createFakeMediaProvidersPort({ providers: { a: { apiKeyConfigured: true, apiKeyTail: '1234' } } });
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    expect(result.current.load).toEqual({ status: 'loading' });

    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));
    expect(result.current.providers).toEqual({ a: { apiKeyConfigured: true, apiKeyTail: '1234' } });
    expect(result.current.hasAnyConfigured).toBe(true);
  });

  it('an unreachable daemon (null) leaves local state exactly as it was, not wiped to {}', async () => {
    const port = createFakeMediaProvidersPort({ unreachable: true });
    const initialProviders: MediaProviderMap = { a: { apiKey: 'typed-locally' } };
    const { result } = renderHook(() => useMediaProvidersTab({ port, initialProviders }));

    await waitFor(() => expect(result.current.load).toEqual({ status: 'unreachable' }));
    // The bug this pins: collapsing null into {} here would drop `a` entirely.
    expect(result.current.providers).toEqual({ a: { apiKey: 'typed-locally' } });
  });

  it('migrates local-only providers to the daemon on first load when the daemon is reachable and empty', async () => {
    const port = createFakeMediaProvidersPort();
    const saveSpy = vi.spyOn(port, 'saveMediaProviders');
    const initialProviders: MediaProviderMap = { a: { apiKey: 'sk-local' } };
    renderHook(() => useMediaProvidersTab({ port, initialProviders }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledWith({ a: { apiKey: 'sk-local' } }));
  });

  it('does NOT migrate when the daemon already manages something — it is authoritative', async () => {
    const port = createFakeMediaProvidersPort({ providers: { b: { apiKeyConfigured: true } } });
    const saveSpy = vi.spyOn(port, 'saveMediaProviders');
    const initialProviders: MediaProviderMap = { a: { apiKey: 'sk-local' } };
    const { result } = renderHook(() => useMediaProvidersTab({ port, initialProviders }));

    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe('useMediaProvidersTab — updateProvider', () => {
  it('sets a field and marks the provider pending', async () => {
    const port = createFakeMediaProvidersPort();
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.updateProvider('a', { apiKey: 'sk-1' });
    await waitFor(() => expect(result.current.providers.a).toEqual({ apiKey: 'sk-1' }));
    expect(result.current.pendingProviderIds.has('a')).toBe(true);
  });

  it('merges a patch onto the existing entry rather than replacing it', async () => {
    const port = createFakeMediaProvidersPort({ providers: { a: { apiKeyConfigured: true, apiKeyTail: '1234' } } });
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.providers.a).toEqual({ apiKeyConfigured: true, apiKeyTail: '1234' }));

    result.current.updateProvider('a', { baseUrl: 'https://typed' });
    await waitFor(() =>
      expect(result.current.providers.a).toEqual({ apiKeyConfigured: true, apiKeyTail: '1234', baseUrl: 'https://typed' }),
    );
  });

  it('drops the provider entirely once every field is patched back to empty', async () => {
    const port = createFakeMediaProvidersPort();
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.updateProvider('a', { apiKey: 'sk-1' });
    await waitFor(() => expect(result.current.providers.a).toBeDefined());
    result.current.updateProvider('a', { apiKey: '' });
    await waitFor(() => expect(result.current.providers.a).toBeUndefined());
  });
});

describe('useMediaProvidersTab — clearProvider', () => {
  it('removes the provider and persists the removal immediately', async () => {
    const port = createFakeMediaProvidersPort({ providers: { a: { apiKeyConfigured: true } } });
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.providers.a).toBeDefined());

    result.current.clearProvider('a');
    await waitFor(() => expect(result.current.save).toEqual({ status: 'saved' }));
    expect(result.current.providers.a).toBeUndefined();
    await expect(port.fetchMediaProviders()).resolves.toEqual({});
  });

  it('rolls the optimistic clear back when the daemon rejects the save', async () => {
    const port: MediaProvidersPort = {
      fetchMediaProviders: () => Promise.resolve({ a: { apiKeyConfigured: true } }),
      saveMediaProviders: () => Promise.reject(new Error('disk full')),
    };
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.providers.a).toBeDefined());

    result.current.clearProvider('a');
    await waitFor(() => expect(result.current.save).toEqual({ status: 'save-error', message: 'disk full' }));
    // The credential the daemon never actually dropped must still be there.
    expect(result.current.providers.a).toEqual({ apiKeyConfigured: true });
  });
});

describe('useMediaProvidersTab — saveChanges', () => {
  it('flushes every current provider and clears pending state on success', async () => {
    const port = createFakeMediaProvidersPort();
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.updateProvider('a', { apiKey: 'sk-1' });
    await waitFor(() => expect(result.current.pendingProviderIds.has('a')).toBe(true));

    result.current.saveChanges();
    await waitFor(() => expect(result.current.save).toEqual({ status: 'saved' }));
    expect(result.current.pendingProviderIds.size).toBe(0);
    await expect(port.fetchMediaProviders()).resolves.toEqual({ a: { apiKey: 'sk-1' } });
  });

  it('stringifies a non-Error rejection instead of throwing on `.message`', async () => {
    const port: MediaProvidersPort = {
      fetchMediaProviders: () => Promise.resolve({}),
      saveMediaProviders: () => Promise.reject('boom'),
    };
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.saveChanges();
    await waitFor(() => expect(result.current.save).toEqual({ status: 'save-error', message: 'boom' }));
  });

  it('reports a save error and keeps the unsaved edit intact', async () => {
    const port = createFakeMediaProvidersPort({ saveError: 'network down' });
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.updateProvider('a', { apiKey: 'sk-1' });
    result.current.saveChanges();
    await waitFor(() => expect(result.current.save).toEqual({ status: 'save-error', message: 'network down' }));
    expect(result.current.providers.a).toEqual({ apiKey: 'sk-1' });
    expect(result.current.pendingProviderIds.has('a')).toBe(true);
  });
});

describe('useMediaProvidersTab — unmount safety', () => {
  it('a save that resolves after unmount does not update state (would otherwise warn "setState on an unmounted component")', async () => {
    let resolveSave: ((value: MediaProviderMap) => void) | undefined;
    const port: MediaProvidersPort = {
      fetchMediaProviders: () => Promise.resolve({}),
      saveMediaProviders: () =>
        new Promise<MediaProviderMap>((resolve) => {
          resolveSave = resolve;
        }),
    };
    const { result, unmount } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.saveChanges();
    await waitFor(() => expect(resolveSave).toBeDefined());
    unmount();
    // Resolving after unmount must be a silent no-op — no React warning, no
    // throw. There is nothing further to assert on `result.current` once
    // unmounted; reaching this line without an unhandled error IS the proof.
    resolveSave!({});
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('a save that rejects after unmount does not update state', async () => {
    let rejectSave: ((error: Error) => void) | undefined;
    const port: MediaProvidersPort = {
      fetchMediaProviders: () => Promise.resolve({}),
      saveMediaProviders: () =>
        new Promise<MediaProviderMap>((_resolve, reject) => {
          rejectSave = reject;
        }),
    };
    const { result, unmount } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.saveChanges();
    await waitFor(() => expect(rejectSave).toBeDefined());
    unmount();
    rejectSave!(new Error('too late'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('useMediaProvidersTab — reload', () => {
  it('preserves a pending local edit over what the server reports for that same provider', async () => {
    const port = createFakeMediaProvidersPort({ providers: { a: { apiKeyTail: '9999', apiKeyConfigured: true } } });
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.updateProvider('a', { apiKey: 'still-typing' });
    await waitFor(() => expect(result.current.pendingProviderIds.has('a')).toBe(true));

    result.current.reload();
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));
    // Layered on top, not replaced — the in-progress edit survives alongside
    // the server's own markers, same contract as `mergeDaemonProviders`.
    expect(result.current.providers.a).toEqual({ apiKey: 'still-typing', apiKeyTail: '9999', apiKeyConfigured: true });
  });

  /**
   * The aggregate/reconciliation risk this whole feature exists to guard
   * against, exercised at the hook boundary (not just `rules.ts` in
   * isolation): a `reload()` that hits an unreachable daemon must not let
   * `null` collapse into `{}` on its way through the hook. If it did, this
   * reload would read as "the server manages nothing" and wipe every local
   * edit below — including ones with real, re-sendable data.
   */
  it('reload against an unreachable daemon leaves ALL local providers untouched — null never collapses to {}', async () => {
    const port: MediaProvidersPort = {
      fetchMediaProviders: vi
        .fn()
        .mockResolvedValueOnce({ a: { apiKeyConfigured: true } })
        .mockResolvedValueOnce(null),
      saveMediaProviders: vi.fn(),
    };
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));
    expect(result.current.providers).toEqual({ a: { apiKeyConfigured: true } });

    result.current.updateProvider('b', { apiKey: 'unsaved-work' });
    await waitFor(() => expect(result.current.providers.b).toBeDefined());

    result.current.reload();
    await waitFor(() => expect(result.current.load).toEqual({ status: 'unreachable' }));
    // Both the untouched server-sourced entry and the brand-new local-only
    // edit must survive a failed reload intact.
    expect(result.current.providers).toEqual({
      a: { apiKeyConfigured: true },
      b: { apiKey: 'unsaved-work' },
    });
  });

  it('ignores a superseded reload response that lands after a newer one', async () => {
    const pending: Array<(value: MediaProviderMap | null) => void> = [];
    const port: MediaProvidersPort = {
      fetchMediaProviders: () =>
        new Promise<MediaProviderMap | null>((resolve) => {
          pending.push(resolve);
        }),
      saveMediaProviders: vi.fn(),
    };
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!({});
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.reload();
    result.current.reload();
    await waitFor(() => expect(pending).toHaveLength(3));

    // The newer (third) request answers first; the second request's slow
    // response must not overwrite it once it eventually arrives.
    pending[2]!({ a: { apiKeyConfigured: true } });
    await waitFor(() => expect(result.current.providers.a).toBeDefined());
    pending[1]!({ b: { apiKeyConfigured: true } });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.providers).toEqual({ a: { apiKeyConfigured: true } });
  });
});

describe('useMediaProvidersTab — overlapping whole-map saves', () => {
  /** A port whose saves are released manually, so two can be in flight at once. */
  function gatedPort(): { port: MediaProvidersPort; release: (index: number, value: MediaProviderMap) => void; calls: MediaProviderMap[] } {
    const calls: MediaProviderMap[] = [];
    const resolvers: Array<(value: MediaProviderMap) => void> = [];
    const port: MediaProvidersPort = {
      fetchMediaProviders: async () => ({ a: { apiKeyConfigured: true, apiKeyTail: '1234' } }),
      saveMediaProviders: async (next) => {
        calls.push(next);
        return new Promise<MediaProviderMap>((resolve) => resolvers.push(resolve));
      },
    };
    return { port, release: (index, value) => resolvers[index]!(value), calls };
  }

  it('does not resurrect a cleared credential when an earlier save resolves last', async () => {
    // Save-then-Clear is an ordinary double-click: nothing disables Clear while
    // a save is in flight, and the port replaces the WHOLE map. Without a ticket
    // on the save edge, the first save's response (whose map still contains `a`)
    // lands last and puts the cleared credential back.
    const { port, release, calls } = gatedPort();
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.saveChanges();
    await waitFor(() => expect(calls).toHaveLength(1));
    result.current.clearProvider('a');
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({});

    // The CLEAR resolves first, then the earlier SAVE resolves with the stale map.
    release(1, {});
    await waitFor(() => expect(result.current.providers).toEqual({}));
    release(0, { a: { apiKeyConfigured: true, apiKeyTail: '1234' } });

    await waitFor(() => expect(result.current.save.status).not.toBe('saving'));
    expect(result.current.providers).toEqual({});
    expect(result.current.hasAnyConfigured).toBe(false);
  });

  it('a superseded save does not roll a clear back either', async () => {
    // The second-order trap: `clearProvider` rolls its optimistic delete back
    // when a save does not succeed. Treating "overtaken" as "failed" would
    // restore the pre-clear map and resurrect the credential by another route.
    const { port, release, calls } = gatedPort();
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.clearProvider('a');
    await waitFor(() => expect(calls).toHaveLength(1));
    result.current.saveChanges();
    await waitFor(() => expect(calls).toHaveLength(2));

    release(1, {});
    await waitFor(() => expect(result.current.save.status).toBe('saved'));
    release(0, {});

    await waitFor(() => expect(result.current.providers).toEqual({}));
    expect(result.current.providers).toEqual({});
  });
});
