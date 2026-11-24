import { describe, expect, it } from 'vitest';
import { createConsentAutosave, type ConsentTimers } from '../consent-autosave.js';
import type { ConsentDraftSaved } from '../settings.hooks.js';
import { conflict, CONSENT_CONFIG, consentErrors, RequestFailure, saved } from './consent-fixtures.js';

/** Timers the test fires by hand, so debounce order is explicit. */
function manualTimers() {
  let next: (() => void) | null = null;
  const timers: ConsentTimers = { setTimeout: ({ callback }, _optional = {}) => { next = callback; return callback; }, clearTimeout: ({ handle }, _optional = {}) => { if (handle === next) next = null; } };
  return { timers, fire: () => { const callback = next; next = null; callback?.(); }, pending: () => next !== null };
}

/** A saveDraft fake whose each call waits until the test resolves or rejects it. */
function heldSaves() {
  const calls: { config: typeof CONSENT_CONFIG; expectedDraftId: string | null; settle: { resolve(value: ConsentDraftSaved): void; reject(error: unknown): void } }[] = [];
  const saveDraft = (input: { config: typeof CONSENT_CONFIG; expectedDraftId: string | null }) => new Promise<ConsentDraftSaved>((resolve, reject) => { calls.push({ ...input, settle: { resolve, reject } }); });
  return { calls, port: { saveDraft } };
}

function recorder() {
  const events: string[] = [];
  return {
    events,
    handlers: {
      onSaving: () => events.push('saving'),
      onSaved: ({ result, settled }: { result: ConsentDraftSaved; settled: boolean }) => events.push(`saved:${result.revision.id}:${settled ? 'settled' : 'more'}`),
      onConflict: () => events.push('conflict'),
      onError: ({ error }: { error: unknown }) => events.push(`error:${(error as Error).message}`),
    },
  };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createConsentAutosave', () => {
  it('debounces edits into one save of the newest config, then chains the returned draft id', async () => {
    const { timers, fire } = manualTimers();
    const { calls, port } = heldSaves();
    const { events, handlers } = recorder();
    const autosave = createConsentAutosave({ port, draftId: 'd0', events: handlers, isConflict: consentErrors.isConflict }, { timers });
    autosave.change({ config: { ...CONSENT_CONFIG, title: 'A' } });
    autosave.change({ config: { ...CONSENT_CONFIG, title: 'AB' } });
    expect(calls).toHaveLength(0);
    fire();
    expect(calls.map(call => [call.config.title, call.expectedDraftId])).toEqual([['AB', 'd0']]);
    calls[0]!.settle.resolve(saved('d1'));
    await tick();
    autosave.change({ config: { ...CONSENT_CONFIG, title: 'ABC' } });
    fire();
    expect(calls[1]).toMatchObject({ expectedDraftId: 'd1' });
    calls[1]!.settle.resolve(saved('d2'));
    await tick();
    expect(events).toEqual(['saving', 'saved:d1:settled', 'saving', 'saved:d2:settled']);
    expect(autosave.draftId()).toBe('d2');
  });

  it('never runs two saves at once: edits during a save go out after it, with its new draft id', async () => {
    const { timers, fire, pending } = manualTimers();
    const { calls, port } = heldSaves();
    const { events, handlers } = recorder();
    const autosave = createConsentAutosave({ port, draftId: null, events: handlers, isConflict: consentErrors.isConflict }, { timers });
    autosave.change({ config: { ...CONSENT_CONFIG, title: 'first' } });
    fire();
    autosave.change({ config: { ...CONSENT_CONFIG, title: 'second' } });
    fire();
    autosave.change({ config: { ...CONSENT_CONFIG, title: 'third' } });
    expect(pending()).toBe(true);
    const flushed = autosave.flush();
    expect(calls).toHaveLength(1);
    calls[0]!.settle.resolve(saved('d1'));
    await tick();
    expect(calls.map(call => [call.config.title, call.expectedDraftId])).toEqual([['first', null], ['third', 'd1']]);
    calls[1]!.settle.resolve(saved('d2'));
    await flushed;
    expect(events).toEqual(['saving', 'saved:d1:more', 'saving', 'saved:d2:settled']);
  });

  it('reports settled=false when a new edit is still waiting on the debounce', async () => {
    const { timers, fire } = manualTimers();
    const { calls, port } = heldSaves();
    const { events, handlers } = recorder();
    const autosave = createConsentAutosave({ port, draftId: null, events: handlers, isConflict: consentErrors.isConflict }, { timers });
    autosave.change({ config: CONSENT_CONFIG });
    fire();
    autosave.change({ config: { ...CONSENT_CONFIG, title: 'later' } });
    calls[0]!.settle.resolve(saved('d1'));
    await tick();
    expect(events).toEqual(['saving', 'saved:d1:more']);
  });

  it('stops for good on a 409: queued edits are dropped and later edits never save over the other editor', async () => {
    const { timers, fire } = manualTimers();
    const { calls, port } = heldSaves();
    const { events, handlers } = recorder();
    const autosave = createConsentAutosave({ port, draftId: 'd0', events: handlers, isConflict: consentErrors.isConflict }, { timers });
    autosave.change({ config: CONSENT_CONFIG });
    fire();
    autosave.change({ config: { ...CONSENT_CONFIG, title: 'queued' } });
    void autosave.flush();
    calls[0]!.settle.reject(conflict());
    await tick();
    autosave.change({ config: { ...CONSENT_CONFIG, title: 'after' } });
    fire();
    await autosave.flush();
    expect(calls).toHaveLength(1);
    expect(events).toEqual(['saving', 'conflict']);
  });

  it('reports other failures and keeps saving later edits from the last good draft id', async () => {
    const { timers, fire } = manualTimers();
    const { calls, port } = heldSaves();
    const { events, handlers } = recorder();
    const autosave = createConsentAutosave({ port, draftId: 'd0', events: handlers, isConflict: consentErrors.isConflict }, { timers, delayMs: 5 });
    autosave.change({ config: CONSENT_CONFIG });
    fire();
    calls[0]!.settle.reject(new RequestFailure({ message: 'Cookie consent settings are unavailable.', status: 503 }));
    await tick();
    autosave.change({ config: CONSENT_CONFIG });
    fire();
    expect(calls[1]).toMatchObject({ expectedDraftId: 'd0' });
    expect(events).toEqual(['saving', 'error:Cookie consent settings are unavailable.', 'saving']);
  });

  it('does nothing on flush before any edit, or after stop', async () => {
    const { timers, pending } = manualTimers();
    const { calls, port } = heldSaves();
    const autosave = createConsentAutosave({ port, draftId: null, events: recorder().handlers, isConflict: consentErrors.isConflict }, { timers });
    await autosave.flush();
    autosave.change({ config: CONSENT_CONFIG });
    autosave.stop();
    expect(pending()).toBe(false);
    autosave.change({ config: CONSENT_CONFIG });
    await autosave.flush();
    expect(calls).toHaveLength(0);
  });

  it('uses the browser timers by default', async () => {
    const { calls, port } = heldSaves();
    const autosave = createConsentAutosave({ port, draftId: null, events: recorder().handlers, isConflict: consentErrors.isConflict }, { delayMs: 1 });
    autosave.change({ config: CONSENT_CONFIG });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
    autosave.stop();
  });
});
