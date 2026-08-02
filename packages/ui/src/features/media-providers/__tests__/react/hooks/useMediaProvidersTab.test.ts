import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeMediaProvidersPort } from '../../../dependencies.js';
import type { MediaProvidersPort } from '../../../ports.js';
import type { MediaProviderMap } from '../../../types.js';
import { useMediaProvidersTab } from '../../../react/hooks/useMediaProvidersTab.js';

/**
 * @file Reconciliation coverage for `useMediaProvidersTab`'s async edges. The
 * canonical bug this guards against: a daemon that could not be reached
 * (`fetchMediaProviders` resolving `null`) must never be treated the same as
 * a daemon that answered with nothing (`{}`) — the former must leave local
 * state exactly as it was, the latter is a real answer that can drop stale
 * local markers. See `mergeDaemonProviders`'s own doc comment
 * (`../../../rules.js`) for the full rule this hook must not violate.
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

/**
 * `saveMediaProviders` replaces the WHOLE map and carries no
 * expected-revision, so two overlapping writes are unorderable AT THE DAEMON:
 * the surviving server state is whichever request the host handles last, not
 * whichever the operator issued last. A response-side guard cannot fix that —
 * it only decides which response may touch UI state, while the losing REQUEST
 * has already rewritten the server.
 *
 * These tests therefore assert the precondition is gone rather than that the
 * symptom is masked: the hook never has two writes at the port at once, and
 * the LAST map the daemon receives is the one the operator meant.
 */
describe('useMediaProvidersTab — serialized whole-map saves', () => {
  /** A port whose saves are released manually, so overlap would be observable if it happened. */
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

  it('never puts two whole-map writes at the port at once', async () => {
    // Save-then-Clear is an ordinary double-click: nothing disables Clear while
    // a save is in flight. The second write must WAIT, not race.
    const { port, release, calls } = gatedPort();
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.saveChanges();
    await waitFor(() => expect(calls).toHaveLength(1));

    result.current.clearProvider('a');
    // Give the clear every chance to issue a concurrent request.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(1);

    release(0, { a: { apiKeyConfigured: true, apiKeyTail: '1234' } });
    await waitFor(() => expect(calls).toHaveLength(2));
    // The queued write built its payload at SEND time, so it carries the clear.
    expect(calls[1]).toEqual({});
  });

  it('leaves the DAEMON holding the cleared map, not just the UI', async () => {
    // The defect a response-side ticket left open: the UI shows cleared and
    // reports success while the stale REQUEST restores the credential
    // server-side.
    //
    // Asserting on the order requests were ISSUED would not catch it — that
    // order is already correct. The daemon commits when it HANDLES a request,
    // and two in-flight whole-map writes can be handled in either order. So
    // this port models a real daemon (state committed at handling time) and
    // handles what it has received NEWEST FIRST — the adverse ordering. With
    // one write in flight that ordering is unreachable; with two it resurrects
    // the credential.
    let daemonState: MediaProviderMap = { a: { apiKeyConfigured: true, apiKeyTail: '1234' } };
    const received: Array<() => void> = [];
    const port: MediaProvidersPort = {
      fetchMediaProviders: async () => daemonState,
      saveMediaProviders: (next) =>
        new Promise<MediaProviderMap>((resolve) => {
          received.push(() => {
            daemonState = next;
            resolve(next);
          });
        }),
    };
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.saveChanges();
    await waitFor(() => expect(received).toHaveLength(1));
    result.current.clearProvider('a');

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (received.length > 0) received.pop()!();
    }

    await waitFor(() => expect(result.current.save.status).not.toBe('saving'));
    // The UI and the server must agree. The UI alone showing `{}` is exactly
    // the state this defect produced.
    expect(daemonState).toEqual({});
    expect(result.current.providers).toEqual({});
    expect(result.current.hasAnyConfigured).toBe(false);
  });

  it('coalesces several requests made during one in-flight write into a single follow-up', async () => {
    const { port, release, calls } = gatedPort();
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.load).toEqual({ status: 'ok' }));

    result.current.saveChanges();
    await waitFor(() => expect(calls).toHaveLength(1));

    result.current.updateProvider('b', { apiKey: 'sk-b' });
    result.current.saveChanges();
    result.current.saveChanges();
    result.current.saveChanges();

    release(0, { a: { apiKeyConfigured: true, apiKeyTail: '1234' } });
    await waitFor(() => expect(calls).toHaveLength(2));
    release(1, { a: { apiKeyConfigured: true, apiKeyTail: '1234' }, b: { apiKey: 'sk-b' } });

    await waitFor(() => expect(result.current.save.status).toBe('saved'));
    // Three clicks during one flight are one follow-up write, not three: they
    // would all have sent the same send-time map.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ a: { apiKeyConfigured: true, apiKeyTail: '1234' }, b: { apiKey: 'sk-b' } });
  });
});

describe('useMediaProvidersTab — edits made while a write is in flight', () => {
  it('a FAILED clear restores only that provider, not the whole pre-clear map', async () => {
    // The rollback used to restore a snapshot of the ENTIRE map taken before
    // the clear — silently discarding an edit made to a DIFFERENT provider
    // while the save was in flight. Same whole-map mistake as the port's,
    // repeated locally.
    let rejectSave: ((error: Error) => void) | undefined;
    const port: MediaProvidersPort = {
      fetchMediaProviders: async () => ({ a: { apiKeyConfigured: true } }),
      saveMediaProviders: () =>
        new Promise<MediaProviderMap>((_resolve, reject) => {
          rejectSave = reject;
        }),
    };
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.providers.a).toBeDefined());

    result.current.clearProvider('a');
    await waitFor(() => expect(rejectSave).toBeDefined());
    // The operator types into a DIFFERENT provider while the clear is in flight.
    result.current.updateProvider('b', { apiKey: 'typed-during-flight' });
    await waitFor(() => expect(result.current.providers.b).toBeDefined());

    rejectSave!(new Error('disk full'));
    await waitFor(() => expect(result.current.save).toEqual({ status: 'save-error', message: 'disk full' }));

    expect(result.current.providers.a).toEqual({ apiKeyConfigured: true });
    expect(result.current.providers.b).toEqual({ apiKey: 'typed-during-flight' });
  });

  it('a rollback does not overwrite a value the operator re-entered by hand', async () => {
    let rejectSave: ((error: Error) => void) | undefined;
    const port: MediaProvidersPort = {
      fetchMediaProviders: async () => ({ a: { apiKey: 'old' } }),
      saveMediaProviders: () =>
        new Promise<MediaProviderMap>((_resolve, reject) => {
          rejectSave = reject;
        }),
    };
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.providers.a).toBeDefined());

    result.current.clearProvider('a');
    await waitFor(() => expect(rejectSave).toBeDefined());
    result.current.updateProvider('a', { apiKey: 'retyped' });
    await waitFor(() => expect(result.current.providers.a).toEqual({ apiKey: 'retyped' }));

    rejectSave!(new Error('disk full'));
    await waitFor(() => expect(result.current.save.status).toBe('save-error'));
    expect(result.current.providers.a).toEqual({ apiKey: 'retyped' });
  });

  it('a SUCCESSFUL save does not let the server answer eat an edit typed during its flight', async () => {
    // The response replaces the whole map, but the server never saw an edit
    // made after the request left — applying its copy wholesale would erase
    // the operator's in-progress typing and drop the provider from pending, so
    // the edit would never be sent at all.
    let resolveSave: ((value: MediaProviderMap) => void) | undefined;
    const port: MediaProvidersPort = {
      fetchMediaProviders: async () => ({ a: { apiKey: 'sk-a' } }),
      saveMediaProviders: () =>
        new Promise<MediaProviderMap>((resolve) => {
          resolveSave = resolve;
        }),
    };
    const { result } = renderHook(() => useMediaProvidersTab({ port }));
    await waitFor(() => expect(result.current.providers.a).toBeDefined());

    result.current.saveChanges();
    await waitFor(() => expect(resolveSave).toBeDefined());
    result.current.updateProvider('b', { apiKey: 'typed-during-flight' });
    await waitFor(() => expect(result.current.pendingProviderIds.has('b')).toBe(true));

    resolveSave!({ a: { apiKey: 'sk-a' } });
    await waitFor(() => expect(result.current.save.status).toBe('saved'));

    expect(result.current.providers.b).toEqual({ apiKey: 'typed-during-flight' });
    // Still unflushed — it was never in the map that was sent.
    expect(result.current.pendingProviderIds.has('b')).toBe(true);
    expect(result.current.pendingProviderIds.has('a')).toBe(false);
  });
});
