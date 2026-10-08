import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsSlice, SAVE_DEBOUNCE_MS, type SettingsSliceRefreshPort } from '../use-settings-slice.hooks.js';
import { useStandingDraftAutosave, type StandingDraftAutosavePort } from '../use-standing-draft-autosave.hooks.js';
import { createStandingDraftLocalBackup } from '../../helpers/standing-draft-local-backup.js';

afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

describe('injected admin lifecycles', () => {
  it('keeps pending edits across a background refresh and diffs an unmount flush against the committed base', async () => {
    vi.useFakeTimers();
    let finishFirst!: () => void;
    const pending = new Promise<void>((resolve) => { finishFirst = resolve; });
    const writes: Array<{ next: string; previous: string }> = [];
    const refreshPort: SettingsSliceRefreshPort = { publish: () => {}, subscribe: () => () => {} };
    const { result, unmount } = renderHook(() => useSettingsSlice({
      defaultValue: 'A', refreshPort, load: async () => 'A',
      save: async (input) => {
        writes.push(input);
        if (writes.length === 1) await pending;
        return ['value'];
      },
    }, {}));
    await act(async () => {});
    act(() => result.current.onChange('B'));
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS); });
    act(() => result.current.onChange('A'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.value).toBe('A');
    unmount();
    await act(async () => { finishFirst(); });
    expect(writes).toEqual([{ next: 'B', previous: 'A' }, { next: 'A', previous: 'B' }]);
  });

  it('parks refused text under the captured principal and recovers it through the injected backup owner', async () => {
    vi.useFakeTimers();
    const backup = createStandingDraftLocalBackup({ keyPrefix: 'editor-refusal.', getStorage: () => localStorage }, {});
    let attempts = 0;
    const port: StandingDraftAutosavePort = {
      getBackupPrincipalId: () => 'operator',
      getAutosave: async () => ({ autosave: null }),
      putAutosave: async () => { attempts++; return { applied: false }; },
      discardAutosave: async () => ({ ok: true }),
    };
    const draft = { bodyFormat: 'html' as const, bodyHtml: 'unsaved text', title: 'draft', slug: 'draft', baseVersion: 1 };
    const first = renderHook(() => useStandingDraftAutosave({ port, backup, entryId: 'entry', enabled: true }, {}));
    await act(async () => {});
    act(() => first.result.current.scheduleAutosave(draft));
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(first.result.current.staleBasis?.draft).toEqual(draft);
    act(() => first.result.current.scheduleAutosave({ ...draft, title: 'next edit' }));
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(attempts).toBe(1);
    expect(backup.read({ entryId: 'entry' }, { principalId: 'different-operator' })).toBeNull();
    first.unmount();
    const second = renderHook(() => useStandingDraftAutosave({ port, backup, entryId: 'entry', enabled: true }, {}));
    await act(async () => {});
    expect(second.result.current.recoverableDraft).toMatchObject(draft);
    await act(async () => { await second.result.current.clearStandingDraft(); });
    expect(backup.read({ entryId: 'entry' }, { principalId: 'operator' })).toBeNull();
  });
});
