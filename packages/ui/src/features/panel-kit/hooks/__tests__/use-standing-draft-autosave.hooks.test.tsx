import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useStandingDraftAutosave,
  type StandingDraftAutosaveInput,
  type StandingDraftAutosaveOptions,
  type StandingDraftAutosavePort,
  type StandingDraftAutosaveSnapshot,
} from '../use-standing-draft-autosave.hooks.js';
import { createStandingDraftLocalBackup } from '../../helpers/standing-draft-local-backup.js';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); }, removeItem: (k: string) => { items.delete(k); } };
}
function makeBackup() {
  const storage = memoryStorage();
  return createStandingDraftLocalBackup({ keyPrefix: 'autosave-test.', getStorage: () => storage }, {});
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const draft = (overrides: Partial<Extract<StandingDraftAutosaveInput, { bodyFormat: 'html' }>> = {}): StandingDraftAutosaveInput =>
  ({ bodyFormat: 'html', bodyHtml: '<p>text</p>', title: 'T', slug: 't', baseVersion: 1, ...overrides });
const snapshot = (savedAt: string, title = 'server'): StandingDraftAutosaveSnapshot =>
  ({ bodyFormat: 'html', bodyHtml: '<p>s</p>', title, slug: 't', baseVersion: 1, savedAt, savedByPrincipalId: 'operator' });

function makePort(overrides: Partial<StandingDraftAutosavePort> = {}) {
  const puts: Array<{ draft: StandingDraftAutosaveInput; keepalive: boolean | undefined }> = [];
  const discards: string[] = [];
  const port: StandingDraftAutosavePort = {
    getBackupPrincipalId: () => 'operator',
    getAutosave: async () => ({ autosave: null }),
    putAutosave: async ({ draft: d }, options) => { puts.push({ draft: d, keepalive: options?.keepalive }); return { applied: true }; },
    discardAutosave: async ({ id }) => { discards.push(id); return { ok: true }; },
    ...overrides,
  };
  return { port, puts, discards };
}

function mount(options: Partial<StandingDraftAutosaveOptions> & Pick<StandingDraftAutosaveOptions, 'port' | 'backup'>) {
  return renderHook((props: Partial<StandingDraftAutosaveOptions>) =>
    useStandingDraftAutosave({ entryId: 'entry', enabled: true, ...options, ...props }, {}), { initialProps: {} });
}

describe('recovering a standing draft on open', () => {
  it('does nothing while disabled or without an entry', async () => {
    const getAutosave = vi.fn(async () => ({ autosave: null }));
    const { port, puts } = makePort({ getAutosave });
    const disabled = mount({ port, backup: makeBackup(), enabled: false });
    const anonymous = mount({ port, backup: makeBackup(), entryId: null });
    await act(async () => {});
    act(() => { disabled.result.current.scheduleAutosave(draft()); anonymous.result.current.scheduleAutosave(draft()); });
    await act(async () => { await anonymous.result.current.clearStandingDraft(); });
    expect(getAutosave).not.toHaveBeenCalled();
    expect(puts).toEqual([]);
  });

  it('prefers whichever of the server autosave and the local backup is newer', async () => {
    const backup = makeBackup();
    backup.write({ entryId: 'entry', draft: draft({ title: 'local' }), savedAt: '2026-01-02T00:00:00.000Z' }, { principalId: 'operator' });
    const newerServer = mount({ port: makePort({ getAutosave: async () => ({ autosave: snapshot('2026-01-03T00:00:00.000Z') }) }).port, backup });
    await act(async () => {});
    expect(newerServer.result.current.recoverableDraft?.title).toBe('server');
    const olderServer = mount({ port: makePort({ getAutosave: async () => ({ autosave: snapshot('2026-01-01T00:00:00.000Z') }) }).port, backup });
    await act(async () => {});
    expect(olderServer.result.current.recoverableDraft?.title).toBe('local');
  });

  it('falls back to the local backup, or nothing, when the server read fails', async () => {
    const backup = makeBackup();
    const failing = makePort({ getAutosave: async () => { throw new Error('offline'); } }).port;
    const none = mount({ port: failing, backup });
    await act(async () => {});
    expect(none.result.current.recoverableDraft).toBeNull();
    backup.write({ entryId: 'entry', draft: draft({ title: 'local' }), savedAt: '2026-01-02T00:00:00.000Z' }, { principalId: 'operator' });
    const local = mount({ port: failing, backup });
    await act(async () => {});
    expect(local.result.current.recoverableDraft?.title).toBe('local');
  });

  it('ignores a server read that settles after the editor closed', async () => {
    const backup = makeBackup();
    const ok = deferred<{ autosave: StandingDraftAutosaveSnapshot | null }>();
    const first = mount({ port: makePort({ getAutosave: () => ok.promise }).port, backup });
    first.unmount();
    await act(async () => { ok.resolve({ autosave: snapshot('2026-01-03T00:00:00.000Z') }); });
    expect(first.result.current.recoverableDraft).toBeNull();
    const failed = deferred<{ autosave: StandingDraftAutosaveSnapshot | null }>();
    const second = mount({ port: makePort({ getAutosave: () => failed.promise }).port, backup });
    second.unmount();
    await act(async () => { failed.reject(new Error('late')); });
    expect(second.result.current.recoverableDraft).toBeNull();
  });

  it('annotates the recoverable draft with the host-supplied server timestamp and can be dismissed', async () => {
    const { port } = makePort({ getAutosave: async () => ({ autosave: snapshot('2026-01-03T00:00:00.000Z') }) });
    const { result } = mount({ port, backup: makeBackup(), serverUpdatedAt: '2026-01-04T00:00:00.000Z' });
    await act(async () => {});
    expect(result.current.recoverableDraft?.serverUpdatedAt).toBe('2026-01-04T00:00:00.000Z');
    act(() => result.current.dismissRecoverable());
    expect(result.current.recoverableDraft).toBeNull();
  });
});

describe('writing autosaves', () => {
  it('writes after the idle debounce and drops the local backup once the server applied it', async () => {
    vi.useFakeTimers();
    const backup = makeBackup();
    backup.write({ entryId: 'entry', draft: draft({ title: 'old local' }), savedAt: '2026-01-01T00:00:00.000Z' }, { principalId: 'operator' });
    const { port, puts } = makePort();
    const { result } = mount({ port, backup });
    await act(async () => {});
    act(() => result.current.scheduleAutosave(draft({ title: 'typed' })));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(puts.map((p) => [p.draft.title, p.keepalive])).toEqual([['typed', false]]);
    expect(backup.read({ entryId: 'entry' }, { principalId: 'operator' })).toBeNull();
  });

  it('caps continuous typing at the maximum wait instead of debouncing forever', async () => {
    vi.useFakeTimers();
    const { port, puts } = makePort();
    const { result } = mount({ port, backup: makeBackup() });
    await act(async () => {});
    for (let i = 0; i < 8; i++) {
      act(() => result.current.scheduleAutosave(draft({ title: `t${i}` })));
      await act(async () => { vi.advanceTimersByTime(2000); });
    }
    expect(puts.map((p) => p.draft.title)).toEqual(['t7']);
  });

  it('flushes a pending autosave with keepalive when the page is hidden, blurred or closed', async () => {
    vi.useFakeTimers();
    const { port, puts } = makePort();
    const { result } = mount({ port, backup: makeBackup() });
    await act(async () => {});
    act(() => result.current.scheduleAutosave(draft({ title: 'hidden' })));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(puts).toEqual([]);
    visibility.mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => result.current.scheduleAutosave(draft({ title: 'blurred' })));
    await act(async () => { window.dispatchEvent(new Event('blur')); });
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    expect(puts.map((p) => [p.draft.title, p.keepalive])).toEqual([['hidden', true], ['blurred', true]]);
  });

  it('parks a 401-refused write in the local backup and only logs other failures', async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const backup = makeBackup();
    let failure: unknown = Object.assign(new Error('expired'), { status: 401 });
    const { port } = makePort({ putAutosave: async () => { throw failure; } });
    const { result } = mount({ port, backup });
    await act(async () => {});
    act(() => result.current.scheduleAutosave(draft({ title: 'unauthorized' })));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(backup.read({ entryId: 'entry' }, { principalId: 'operator' })?.title).toBe('unauthorized');
    await act(async () => { await result.current.clearStandingDraft(); });
    failure = new Error('server error');
    act(() => result.current.scheduleAutosave(draft({ title: 'other failure' })));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(backup.read({ entryId: 'entry' }, { principalId: 'operator' })).toBeNull();
    expect(errors).toHaveBeenCalledWith('standing-draft autosave: request failed');
  });

  it('parks the pending draft of the entry being left when its flushed write is refused', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const backup = makeBackup();
    const { port, puts } = makePort({ putAutosave: async ({ draft: d }) => { puts.push({ draft: d, keepalive: false }); throw Object.assign(new Error('expired'), { status: 401 }); } });
    const { result, rerender } = mount({ port, backup });
    await act(async () => {});
    act(() => result.current.scheduleAutosave(draft({ title: 'left behind' })));
    await act(async () => { rerender({ entryId: 'next-entry' }); });
    expect(puts.map((p) => p.draft.title)).toEqual(['left behind']);
    expect(backup.read({ entryId: 'entry' }, { principalId: 'operator' })?.title).toBe('left behind');
  });

  it('ignores a write that settles after the draft was cleared, whether it succeeded or failed', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const backup = makeBackup();
    const write = deferred<{ applied: boolean }>();
    const { port, discards } = makePort({ putAutosave: () => write.promise });
    const { result } = mount({ port, backup });
    await act(async () => {});
    act(() => result.current.scheduleAutosave(draft({ title: 'in flight' })));
    await act(async () => { vi.advanceTimersByTime(3000); });
    let cleared!: Promise<void>;
    act(() => { cleared = result.current.clearStandingDraft(); });
    await act(async () => { write.reject(Object.assign(new Error('expired'), { status: 401 })); await cleared; });
    expect(backup.read({ entryId: 'entry' }, { principalId: 'operator' })).toBeNull();
    expect(discards).toEqual(['entry']);
    expect(result.current.staleBasis).toBeNull();
  });

  it('ignores an unapplied write after the draft was cleared', async () => {
    vi.useFakeTimers();
    const write = deferred<{ applied: boolean }>();
    const { port } = makePort({ putAutosave: () => write.promise });
    const { result } = mount({ port, backup: makeBackup() });
    await act(async () => {});
    act(() => result.current.scheduleAutosave(draft()));
    await act(async () => { vi.advanceTimersByTime(3000); });
    let cleared!: Promise<void>;
    act(() => { cleared = result.current.clearStandingDraft(); });
    await act(async () => { write.resolve({ applied: false }); await cleared; });
    expect(result.current.staleBasis).toBeNull();
  });
});

describe('stale and superseded bases', () => {
  it('holds further autosaves on a refused basis until the base version changes', async () => {
    vi.useFakeTimers();
    let applied = false;
    const { port, puts } = makePort({ putAutosave: async ({ draft: d }) => { puts.push({ draft: d, keepalive: false }); return { applied }; } });
    const { result } = mount({ port, backup: makeBackup() });
    await act(async () => {});
    act(() => result.current.scheduleAutosave(draft({ title: 'v1' })));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(result.current.staleBasis?.baseVersion).toBe(1);
    act(() => result.current.scheduleAutosave(draft({ title: 'v1 again' })));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(puts).toHaveLength(1);
    applied = true;
    act(() => result.current.scheduleAutosave(draft({ title: 'v2', baseVersion: 2 })));
    expect(result.current.staleBasis).toBeNull();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(puts.map((p) => p.draft.title)).toEqual(['v1', 'v2']);
  });

  it('drops a pending autosave and a stale gate whose basis a newer save superseded', async () => {
    vi.useFakeTimers();
    const { port, puts } = makePort({ putAutosave: async ({ draft: d }) => { puts.push({ draft: d, keepalive: false }); return { applied: false }; } });
    const { result } = mount({ port, backup: makeBackup() });
    await act(async () => {});
    act(() => result.current.scheduleAutosave(draft({ title: 'refused' })));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(result.current.staleBasis).not.toBeNull();
    act(() => result.current.supersedeBasis(2));
    expect(result.current.staleBasis).toBeNull();
    act(() => result.current.scheduleAutosave(draft({ title: 'old basis' })));
    act(() => result.current.scheduleAutosave(draft({ title: 'pending', baseVersion: 2 })));
    act(() => result.current.supersedeBasis(3));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(puts.map((p) => p.draft.title)).toEqual(['refused']);
  });

  it('does not raise a stale gate for an unapplied write whose basis was superseded meanwhile', async () => {
    vi.useFakeTimers();
    const write = deferred<{ applied: boolean }>();
    const { port } = makePort({ putAutosave: () => write.promise });
    const { result } = mount({ port, backup: makeBackup() });
    await act(async () => {});
    act(() => result.current.scheduleAutosave(draft()));
    await act(async () => { vi.advanceTimersByTime(3000); });
    act(() => result.current.supersedeBasis(5));
    await act(async () => { write.resolve({ applied: false }); });
    expect(result.current.staleBasis).toBeNull();
  });
});

describe('preserveFailedSave', () => {
  it('backs up only drafts whose explicit save was refused as unauthorized', async () => {
    const backup = makeBackup();
    const { port } = makePort();
    const { result } = mount({ port, backup });
    await act(async () => {});
    act(() => result.current.preserveFailedSave({ error: new Error('conflict'), draft: draft({ title: 'kept in editor' }) }));
    expect(backup.read({ entryId: 'entry' }, { principalId: 'operator' })).toBeNull();
    act(() => result.current.preserveFailedSave({ error: { status: 401 }, draft: draft({ title: 'parked' }) }));
    expect(backup.read({ entryId: 'entry' }, { principalId: 'operator' })?.title).toBe('parked');
  });
});
