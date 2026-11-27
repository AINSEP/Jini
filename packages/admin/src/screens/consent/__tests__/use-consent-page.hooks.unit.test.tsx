// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ConsentTimers } from '../consent-autosave.js';
import type { ConsentDraftSaved, ConsentPreview, ConsentReadiness, ConsentRevisionsPort, ConsentSettingsSnapshot } from '../settings.hooks.js';
import { useConsentPage, useConsentPreview, useConsentPreviewScale, useConsentReadiness } from '../use-consent-page.hooks.js';
import { conflict, CONSENT_CONFIG, consentErrors, consentSnapshot, fakeConsentPort, RequestFailure, revision, saved } from './consent-fixtures.js';

/** @file The Cookie Consent controller: load, draft autosave, the 409 stop, and Publish. */

const t = (key: string) => key;

/** Stands in for the engine's fit rule: a 1024px desktop page; no width keeps the natural size. */
const fitScale = ({ paneWidth }: { paneWidth: number }) => (paneWidth === 0 ? 1 : paneWidth / 1024);

/** Autosave timers the test fires by hand. */
function manualTimers() {
  let next: (() => void) | null = null;
  const timers: ConsentTimers = { setTimeout: ({ callback }, _optional = {}) => { next = callback; return callback; }, clearTimeout: ({ handle }, _optional = {}) => { if (handle === next) next = null; } };
  return { timers, fire: () => { const callback = next; next = null; callback?.(); } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const withDraft = consentSnapshot({ draft: revision('d1'), published: revision('p1', { ...CONSENT_CONFIG, enabled: false }) });

async function mountPage(port: ConsentRevisionsPort) {
  const { timers, fire } = manualTimers();
  const hook = renderHook(() => useConsentPage({ port, t, errors: consentErrors }, { delayMs: 5, timers }));
  await waitFor(() => expect(hook.result.current.value).not.toBeNull());
  return { ...hook, fire };
}

/** Edits the title and lets the debounced save run to completion. */
async function editAndSave(page: Awaited<ReturnType<typeof mountPage>>, title = 'New title') {
  act(() => page.result.current.onChange({ patch: { title } }));
  await act(async () => { page.fire(); });
}

describe('useConsentPage: load', () => {
  it('edits the draft when there is one and reports what is live', async () => {
    const page = await mountPage(fakeConsentPort({ get: () => Promise.resolve(withDraft) }));
    expect(page.result.current).toMatchObject({
      value: CONSENT_CONFIG, draftId: 'd1', hasUnpublished: true, everPublished: true, liveEnabled: false,
      saveState: 'idle', loadError: null, editor: withDraft.editor, canPublish: true, publishedCount: 0,
    });
  });

  it('starts from the live settings before the first draft, with nothing to publish', async () => {
    const page = await mountPage(fakeConsentPort());
    expect(page.result.current).toMatchObject({ value: { ...CONSENT_CONFIG, enabled: false }, draftId: null, hasUnpublished: false, everPublished: false, canPublish: false });
  });

  it('shows the load error', async () => {
    const port = fakeConsentPort({ get: () => Promise.reject(new RequestFailure({ message: '', status: 503 })) });
    const { result } = renderHook(() => useConsentPage({ port, t, errors: consentErrors }));
    await waitFor(() => expect(result.current.loadError).toBe("Couldn't load cookie consent."));
    expect(result.current.value).toBeNull();
  });

  it('ignores a load that settles after unmount', async () => {
    const ok = deferred<ConsentSettingsSnapshot>();
    const failed = deferred<ConsentSettingsSnapshot>();
    const okPort = fakeConsentPort({ get: () => ok.promise });
    const failedPort = fakeConsentPort({ get: () => failed.promise });
    const first = renderHook(() => useConsentPage({ port: okPort, t, errors: consentErrors }));
    const second = renderHook(() => useConsentPage({ port: failedPort, t, errors: consentErrors }));
    first.unmount();
    second.unmount();
    await act(async () => { ok.resolve(withDraft); failed.reject(new Error('gone')); });
    expect(first.result.current.value).toBeNull();
    expect(second.result.current.loadError).toBeNull();
  });

  it('ignores edits before the settings have loaded', () => {
    const port = fakeConsentPort({ get: () => new Promise<ConsentSettingsSnapshot>(() => {}) });
    const { result } = renderHook(() => useConsentPage({ port, t, errors: consentErrors }));
    act(() => result.current.onChange({ patch: { title: 'Early' } }));
    expect(result.current.value).toBeNull();
  });

  it('reload fetches the revisions again', async () => {
    const get = vi.fn(() => Promise.resolve(withDraft));
    const page = await mountPage(fakeConsentPort({ get }));
    act(() => page.result.current.reload());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

describe('useConsentPage: autosave', () => {
  it('saves edits as a draft carrying the last draft id; Publish waits for the save to settle', async () => {
    const save = deferred<ConsentDraftSaved>();
    const saveDraft = vi.fn(() => save.promise);
    const page = await mountPage(fakeConsentPort({ get: () => Promise.resolve(withDraft), saveDraft }));
    act(() => page.result.current.onChange({ patch: { title: 'New title' } }));
    expect(page.result.current.value?.title).toBe('New title');
    expect(page.result.current.canPublish).toBe(false);
    act(() => page.fire());
    expect(page.result.current.saveState).toBe('saving');
    expect(saveDraft).toHaveBeenCalledWith({ config: { ...CONSENT_CONFIG, title: 'New title' }, expectedDraftId: 'd1' });
    await act(async () => { save.resolve(saved('d2')); });
    expect(page.result.current).toMatchObject({ saveState: 'saved', draftId: 'd2', hasUnpublished: true, canPublish: true });
  });

  it("keeps Publish off while the saved draft has problems", async () => {
    const problems = [{ field: 'customCss', code: 'CSS_UNSAFE', message: 'Unsafe CSS.' }];
    const page = await mountPage(fakeConsentPort({ saveDraft: () => Promise.resolve(saved('d2', problems)) }));
    await editAndSave(page);
    expect(page.result.current.problems).toEqual(problems);
    expect(page.result.current.canPublish).toBe(false);
  });

  it('stops on a 409 and never saves over the other edit', async () => {
    const saveDraft = vi.fn(() => Promise.reject(conflict()));
    const page = await mountPage(fakeConsentPort({ get: () => Promise.resolve(withDraft), saveDraft }));
    await editAndSave(page);
    expect(page.result.current.saveState).toBe('conflict');
    expect(page.result.current.canPublish).toBe(false);
    act(() => page.result.current.onChange({ patch: { title: 'Again' } }));
    act(() => page.fire());
    expect(page.result.current.value?.title).toBe('New title');
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  it('keeps the edits and shows the error when a save fails', async () => {
    const page = await mountPage(fakeConsentPort({ saveDraft: () => Promise.reject(new RequestFailure({ message: 'Disk full.', status: 500 })) }));
    await editAndSave(page);
    expect(page.result.current).toMatchObject({ saveState: 'error', saveError: 'Disk full.', value: { title: 'New title' } });
  });
});

describe('useConsentPage: publish', () => {
  it('publishes the saved draft against the live revision it was edited on', async () => {
    const publish = vi.fn(() => Promise.resolve({ published: true as const, revisionId: 'd2' }));
    const page = await mountPage(fakeConsentPort({ get: () => Promise.resolve(withDraft), saveDraft: () => Promise.resolve(saved('d2')), publish }));
    await editAndSave(page);
    await act(async () => { await page.result.current.publish(); });
    expect(publish).toHaveBeenCalledWith({ draftId: 'd2', expectedPublishedId: 'p1' });
    expect(page.result.current).toMatchObject({ hasUnpublished: false, everPublished: true, liveEnabled: true, publishedCount: 1, publishing: false, canPublish: false });
  });

  it('publishes the first draft against no live revision', async () => {
    const publish = vi.fn(() => Promise.resolve({ published: true as const, revisionId: 'd1' }));
    const page = await mountPage(fakeConsentPort({ get: () => Promise.resolve(consentSnapshot({ draft: revision('d1') })), publish }));
    await act(async () => { await page.result.current.publish(); });
    expect(publish).toHaveBeenCalledWith({ draftId: 'd1', expectedPublishedId: null });
  });

  it('does nothing while there is nothing to publish', async () => {
    const publish = vi.fn();
    const page = await mountPage(fakeConsentPort({ publish }));
    await act(async () => { await page.result.current.publish(); });
    expect(publish).not.toHaveBeenCalled();
  });

  it('turns a stale publish (409) into the reload notice and stops autosave', async () => {
    const saveDraft = vi.fn(() => Promise.resolve(saved('d2')));
    const page = await mountPage(fakeConsentPort({ get: () => Promise.resolve(withDraft), saveDraft, publish: () => Promise.reject(conflict()) }));
    await act(async () => { await page.result.current.publish(); });
    expect(page.result.current).toMatchObject({ saveState: 'conflict', publishError: null, publishing: false });
    act(() => page.result.current.onChange({ patch: { title: 'Again' } }));
    act(() => page.fire());
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it('shows any other publish error and keeps the draft', async () => {
    const page = await mountPage(fakeConsentPort({ get: () => Promise.resolve(withDraft), publish: () => Promise.reject(new RequestFailure({ message: '', status: 503 })) }));
    await act(async () => { await page.result.current.publish(); });
    expect(page.result.current).toMatchObject({ publishError: "Couldn't publish.", hasUnpublished: true, saveState: 'idle' });
  });
});

describe('useConsentPreview', () => {
  const preview = (html: string): ConsentPreview => ({ html, blockingProblems: [], revisionId: null });

  it('renders nothing until there is a config', () => {
    const port = fakeConsentPort({ preview: vi.fn() });
    const { result } = renderHook(() => useConsentPreview({ port, config: null, t, errors: consentErrors }));
    expect(result.current).toEqual({ html: null, problems: [], warnings: [], error: null });
    expect(port.preview).not.toHaveBeenCalled();
  });

  it('drops a response that arrives after a newer request was sent', async () => {
    const responses = [deferred<ConsentPreview>(), deferred<ConsentPreview>()];
    let call = 0;
    const port = fakeConsentPort({ preview: () => responses[call++]!.promise });
    const { result, rerender } = renderHook(({ config }) => useConsentPreview({ port, config, t, errors: consentErrors }, { delayMs: 0 }), { initialProps: { config: CONSENT_CONFIG } });
    await waitFor(() => expect(call).toBe(1));
    rerender({ config: { ...CONSENT_CONFIG, title: 'Newer' } });
    await waitFor(() => expect(call).toBe(2));
    await act(async () => { responses[0]!.resolve(preview('<p>old</p>')); });
    expect(result.current.html).toBeNull();
    await act(async () => { responses[1]!.resolve(preview('<p>new</p>')); });
    expect(result.current.html).toBe('<p>new</p>');
  });

  it('keeps CSS warnings separate from blockers and clears them with a clean preview', async () => {
    const warnings = [{ field: 'appearance', code: 'selector', message: 'Selector was skipped.' }];
    const responses = [deferred<ConsentPreview>(), deferred<ConsentPreview>()];
    let call = 0;
    const port = fakeConsentPort({ preview: () => responses[call++]!.promise });
    const { result, rerender } = renderHook(({ config }) => useConsentPreview({ port, config, t, errors: consentErrors }, { delayMs: 0 }), { initialProps: { config: CONSENT_CONFIG } });
    await waitFor(() => expect(call).toBe(1));
    await act(async () => { responses[0]!.resolve({ ...preview('<p>styled</p>'), warnings }); });
    expect(result.current.warnings).toEqual(warnings);
    expect(result.current.problems).toEqual([]);
    rerender({ config: { ...CONSENT_CONFIG, customCss: '' } });
    await waitFor(() => expect(call).toBe(2));
    await act(async () => { responses[1]!.resolve(preview('<p>clean</p>')); });
    expect(result.current.warnings).toEqual([]);
    expect(result.current.html).toBe('<p>clean</p>');
  });

  it('keeps the last preview and reports a render failure', async () => {
    let fail = false;
    const port = fakeConsentPort({ preview: () => fail ? Promise.reject(new RequestFailure({ message: '', status: 500 })) : Promise.resolve(preview('<p>ok</p>')) });
    const { result, rerender } = renderHook(({ config }) => useConsentPreview({ port, config, t, errors: consentErrors }, { delayMs: 0 }), { initialProps: { config: CONSENT_CONFIG } });
    await waitFor(() => expect(result.current.html).toBe('<p>ok</p>'));
    fail = true;
    rerender({ config: { ...CONSENT_CONFIG, title: 'Broken' } });
    await waitFor(() => expect(result.current.error).toBe("Couldn't render the preview."));
    expect(result.current.html).toBe('<p>ok</p>');
  });

  it('drops a failure that arrives after a newer request was sent', async () => {
    const responses = [deferred<ConsentPreview>(), deferred<ConsentPreview>()];
    let call = 0;
    const port = fakeConsentPort({ preview: () => responses[call++]!.promise });
    const { result, rerender } = renderHook(({ config }) => useConsentPreview({ port, config, t, errors: consentErrors }, { delayMs: 0 }), { initialProps: { config: CONSENT_CONFIG } });
    await waitFor(() => expect(call).toBe(1));
    rerender({ config: { ...CONSENT_CONFIG, title: 'Newer' } });
    await waitFor(() => expect(call).toBe(2));
    await act(async () => { responses[0]!.reject(new Error('late')); });
    expect(result.current.error).toBeNull();
  });

  it('waits half a second by default', async () => {
    vi.useFakeTimers();
    try {
      const port = fakeConsentPort({ preview: vi.fn(() => Promise.resolve(preview('<p>x</p>'))) });
      renderHook(() => useConsentPreview({ port, config: CONSENT_CONFIG, t, errors: consentErrors }));
      act(() => { vi.advanceTimersByTime(499); });
      expect(port.preview).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(port.preview).toHaveBeenCalledWith({ config: CONSENT_CONFIG });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useConsentReadiness', () => {
  const ready: ConsentReadiness = { ready: true, enabled: false, blockingProblems: [], declarations: [], warnings: [], truncated: false, limitations: [] };

  it('loads readiness and reloads when `refresh` changes', async () => {
    const readiness = vi.fn(() => Promise.resolve(ready));
    const port = fakeConsentPort({ readiness });
    const { result, rerender } = renderHook(({ refresh }) => useConsentReadiness({ port, refresh, t, errors: consentErrors }), { initialProps: { refresh: '0:' } });
    await waitFor(() => expect(result.current).toEqual({ readiness: ready, error: null }));
    rerender({ refresh: '1:' });
    await waitFor(() => expect(readiness).toHaveBeenCalledTimes(2));
  });

  it('reports a failed check', async () => {
    const port = fakeConsentPort({ readiness: () => Promise.reject(new RequestFailure({ message: '', status: 503 })) });
    const { result } = renderHook(() => useConsentReadiness({ port, refresh: '', t, errors: consentErrors }));
    await waitFor(() => expect(result.current).toEqual({ readiness: null, error: "Couldn't check readiness." }));
  });

  it('ignores a check that settles after unmount', async () => {
    const ok = deferred<ConsentReadiness>();
    const failed = deferred<ConsentReadiness>();
    const okPort = fakeConsentPort({ readiness: () => ok.promise });
    const failedPort = fakeConsentPort({ readiness: () => failed.promise });
    const first = renderHook(() => useConsentReadiness({ port: okPort, refresh: '', t, errors: consentErrors }));
    const second = renderHook(() => useConsentReadiness({ port: failedPort, refresh: '', t, errors: consentErrors }));
    first.unmount();
    second.unmount();
    await act(async () => { ok.resolve(ready); failed.reject(new Error('gone')); });
    expect(first.result.current.readiness).toBeNull();
    expect(second.result.current.error).toBeNull();
  });
});

describe('useConsentPreviewScale', () => {
  it('fits the desktop-width page to the observed pane, and stops observing a detached pane', () => {
    let notify: ((entries: { contentRect: { width: number } }[]) => void) | null = null;
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(callback: typeof notify) { notify = callback; } observe = observe; disconnect = disconnect; });
    try {
      const { result } = renderHook(() => useConsentPreviewScale({ previewScale: fitScale }));
      expect(result.current.scale).toBe(1);
      const pane = document.createElement('div');
      act(() => result.current.ref(pane));
      expect(observe).toHaveBeenCalledWith(pane);
      act(() => notify!([{ contentRect: { width: 512 } }]));
      expect(result.current.scale).toBe(0.5);
      act(() => notify!([]));
      expect(result.current.scale).toBe(1);
      act(() => result.current.ref(null));
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the natural size where ResizeObserver does not exist', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    try {
      const { result } = renderHook(() => useConsentPreviewScale({ previewScale: fitScale }));
      act(() => result.current.ref(document.createElement('div')));
      expect(result.current.scale).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it('discards an old readiness rejection after a newer refresh succeeds', async () => {
  const first = deferred<ConsentReadiness>();
  const next = await fakeConsentPort().readiness();
  const readiness = vi.fn<ConsentRevisionsPort['readiness']>().mockReturnValueOnce(first.promise).mockResolvedValueOnce({ ...next, enabled: true });
  const port = fakeConsentPort({ readiness });
  const { result, rerender } = renderHook(({ refresh }) =>
    useConsentReadiness({ port, refresh, t, errors: consentErrors }), { initialProps: { refresh: '1:d1' } });
  await waitFor(() => expect(readiness).toHaveBeenCalledTimes(1));
  rerender({ refresh: '2:d2' });
  await waitFor(() => expect(result.current.readiness?.enabled).toBe(true));
  await act(async () => { first.reject(new Error('Old check failed')); });
  expect(result.current).toEqual({ readiness: { ...next, enabled: true }, error: null });
});

it('reports the published revision as live even when the draft changes while Publish is pending', async () => {
  const held = deferred<{ published: true; revisionId: string }>();
  const publish = vi.fn<ConsentRevisionsPort['publish']>().mockReturnValue(held.promise);
  const page = await mountPage(fakeConsentPort({ get: async () => withDraft, publish }));
  expect(page.result.current).toMatchObject({ value: { enabled: true }, liveEnabled: false, canPublish: true });
  let completed!: Promise<void>;
  act(() => { completed = page.result.current.publish(); });
  expect(publish).toHaveBeenCalledExactlyOnceWith({ draftId: 'd1', expectedPublishedId: 'p1' });
  expect(page.result.current.publishing).toBe(true);
  act(() => page.result.current.onChange({ patch: { enabled: false } }));
  expect(page.result.current.value?.enabled).toBe(false);
  await act(async () => { held.resolve({ published: true, revisionId: 'd1' }); await completed; });
  expect(page.result.current).toMatchObject({ value: { enabled: false }, liveEnabled: true, publishedCount: 1 });
});
