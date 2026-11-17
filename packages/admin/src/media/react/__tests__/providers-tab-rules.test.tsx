import type { ChangeEvent, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '../../../__tests__/fetch-query-support.js';
import type { AdminMediaProvidersKit, MediaProviderCredentials, MediaProviderMap } from '../../../react/kit-media-providers.js';
import { MediaPortsContext } from '../hooks/MediaPorts.hooks.js';
import { useProvidersTab } from '../hooks/ProvidersTab.hooks.js';
import type { MediaApiPort, MediaProvidersPort } from '../../ports.js';

const change = (value: string) => ({ currentTarget: { value } }) as ChangeEvent<HTMLInputElement>;

/** A provider service with a fixed catalog and nothing stored; every answer the rules give is the test's. */
const emptyService: MediaProvidersPort = {
  catalog: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', defaultBaseUrl: 'https://c.test' }],
  pinnedProviderIds: ['b'],
  list: async () => [],
  saveSettings: async ({ id, baseUrl, model }) => ({ id, label: id.toUpperCase(), configured: false, baseUrl, model }),
  saveCredential: async ({ id }) => ({ id, label: id.toUpperCase(), configured: true }),
  removeCredential: async ({ id }) => ({ id, label: id.toUpperCase(), configured: false }),
};

/**
 * Rules whose answers cannot be mistaken for the real ones: the tab shows only what these return, so any
 * row field that still comes from an imported rule would differ from the sentinel.
 */
function sentinelRules(state: { invalidIds: readonly string[]; present: boolean; badUrl: boolean }) {
  const sorts: { catalog: readonly { id: string }[]; providers: MediaProviderMap | null | undefined; pinnedIds: readonly string[] | undefined }[] = [];
  const masked: (MediaProviderCredentials | null | undefined)[] = [];
  const rules: AdminMediaProvidersKit['rules'] = {
    sortProvidersByConfigured: (catalog, providers, pinnedIds) => { sorts.push({ catalog, providers, pinnedIds }); return [...catalog].reverse(); },
    isEntryPresent: () => state.present,
    isMarkerOnlyEntry: () => true,
    maskedKeyLabel: (entry) => { masked.push(entry); return 'SENTINEL-MASK'; },
    isProviderBaseUrlInvalid: () => state.badUrl,
    invalidBaseUrlProviderIds: () => state.invalidIds,
  };
  return { rules, sorts, masked };
}

function mount(rules: AdminMediaProvidersKit['rules']) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MediaPortsContext.Provider value={{ mediaApi: {} as MediaApiPort, mediaProviders: emptyService }}>{children}</MediaPortsContext.Provider>
  );
  return renderHook(() => useProvidersTab({}, { useRules: () => rules }), { wrapper });
}
const loaded = (view: ReturnType<typeof mount>) => waitFor(() => expect(view.result.current.reloadDisabled).toBe(false));

describe('media useProvidersTab rule port', () => {
  it('orders rows with the injected sort rule, handing it the catalog, the editor state and the pinned ids', async () => {
    const { rules, sorts } = sentinelRules({ invalidIds: [], present: false, badUrl: false });
    const view = mount(rules);
    await loaded(view);
    expect(view.result.current.rows.map(item => [item.id, item.divider])).toEqual([['c', false], ['b', false], ['a', true]]);
    const last = sorts.at(-1)!;
    expect(last.pinnedIds).toEqual(['b']);
    expect(last.catalog.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(last.providers).toEqual({});
  });

  it('takes the saved status, mask, clear state and URL validity of every row from the injected rules', async () => {
    const state = { invalidIds: [] as readonly string[], present: false, badUrl: true };
    const { rules, masked } = sentinelRules(state);
    const view = mount(rules);
    await loaded(view);
    const row = view.result.current.rows.find(item => item.id === 'a')!;
    expect(row).toMatchObject({ statusLabel: 'Saved (SENTINEL-MASK)', credentialPlaceholder: 'SENTINEL-MASK', clearDisabled: true, invalid: true, ariaInvalid: true, hintRole: 'alert' });
    expect(masked.length).toBeGreaterThan(0);
    state.present = true; state.badUrl = false;
    view.rerender();
    expect(view.result.current.rows.find(item => item.id === 'a')).toMatchObject({ clearDisabled: false, invalid: false, hint: null });
    expect(view.result.current.rows.find(item => item.id === 'c')?.hint).toBe('Uses https://c.test by default.');
  });

  it('blocks Save only while the injected rule reports an invalid base URL', async () => {
    const state = { invalidIds: [] as readonly string[], present: true, badUrl: false };
    const view = mount(sentinelRules(state).rules);
    await loaded(view);
    act(() => view.result.current.rows.find(item => item.id === 'a')!.onModel(change('m')));
    expect(view.result.current.saveDisabled).toBe(false);
    state.invalidIds = ['a'];
    view.rerender();
    expect(view.result.current.saveDisabled).toBe(true);
  });
});
