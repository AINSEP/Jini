import { act, renderHook, waitFor } from '@testing-library/react';
import type { ChangeEvent, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useProvidersTab } from '../hooks/ProvidersTab.hooks.js';
import { MediaPortsContext } from '../hooks/MediaPorts.hooks.js';
import type { MediaProvider } from '../../models.js';
import type { MediaApiPort, MediaProvidersPort } from '../../ports.js';

const change = (value: string) => ({ currentTarget: { value } }) as ChangeEvent<HTMLInputElement>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

// A hand-written provider service: `list` answers from `stored`, writes mutate it.
function service(stored: MediaProvider[]) {
  const port = {
    list: vi.fn(async () => stored.map(item => ({ ...item }))),
    saveSettings: vi.fn(async ({ id, baseUrl, model }: { id: string; baseUrl: string; model: string }) => {
      stored = stored.map(item => item.id === id ? { ...item, baseUrl, model } : item);
      return stored.find(item => item.id === id)!;
    }),
    saveCredential: vi.fn(async ({ id, credential }: { id: string; credential: string }) => {
      stored = stored.map(item => item.id === id ? { ...item, configured: true, apiKeyTail: credential.slice(-4) } : item);
      return stored.find(item => item.id === id)!;
    }),
    removeCredential: vi.fn(async ({ id }: { id: string }) => {
      stored = stored.map(item => item.id === id ? { id: item.id, label: item.label, configured: false } : item);
      return stored.find(item => item.id === id)!;
    }),
  };
  return port;
}
function mount(mediaProviders?: MediaProvidersPort) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MediaPortsContext.Provider value={{ mediaApi: {} as MediaApiPort, ...(mediaProviders ? { mediaProviders } : {}) }}>{children}</MediaPortsContext.Provider>
  );
  return renderHook(() => useProvidersTab(), { wrapper });
}
const row = (view: ReturnType<typeof mount>, id: string) => view.result.current.rows.find(item => item.id === id)!;
const loaded = (view: ReturnType<typeof mount>) => waitFor(() => expect(view.result.current.reloadDisabled).toBe(false));

describe('media useProvidersTab', () => {
  it('fails closed and reports the service unreachable without a provider port', async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.unreachable).toBe(true));
    expect(view.result.current).toMatchObject({ rows: [], disabled: true, settingsDisabled: true, saveDisabled: true, empty: true });
    act(() => view.result.current.save());
    await waitFor(() => expect(view.result.current.saveError).toBe(true));
  });

  it('treats a failed or abandoned read as unreachable', async () => {
    const view = mount({ ...service([]), list: vi.fn(async () => { throw new Error('down'); }) });
    await waitFor(() => expect(view.result.current.unreachable).toBe(true));
    const read = deferred<readonly MediaProvider[] | null>();
    const late = mount({ ...service([]), list: vi.fn(() => read.promise) });
    late.unmount();
    await act(async () => read.resolve([{ id: 'x', label: 'X', configured: true }]));
  });

  it('discovers the catalog from the read and keeps only providers with saved state', async () => {
    const view = mount(service([
      { id: 'keyed', label: 'Keyed', configured: true, apiKeyTail: 'abcd' },
      { id: 'marker', label: 'Marker', configured: true },
      { id: 'endpoint', label: 'Endpoint', configured: false, baseUrl: 'https://api.endpoint.test' },
      { id: 'blank', label: 'Blank', configured: false, baseUrl: '  ', model: '  ' },
      { id: 'modelled', label: 'Modelled', configured: false, model: 'm-1' },
    ]));
    await loaded(view);
    expect(view.result.current.rows.map(item => item.id).sort()).toEqual(['blank', 'endpoint', 'keyed', 'marker', 'modelled']);
    expect(row(view, 'keyed')).toMatchObject({ statusLabel: 'Saved (••••abcd)', statusClassName: 'jini-field-status-badge jini-field-status-badge-success', credentialPlaceholder: '••••abcd' });
    expect(row(view, 'marker')).toMatchObject({ statusLabel: 'Saved (••••)' });
    expect(row(view, 'endpoint')).toMatchObject({ statusLabel: null, baseUrl: 'https://api.endpoint.test', clearDisabled: false });
    expect(row(view, 'modelled')).toMatchObject({ model: 'm-1' });
    expect(row(view, 'blank')).toMatchObject({ statusLabel: null, baseUrl: '', model: '', clearDisabled: true, credentialPlaceholder: 'Paste your API key' });
    expect(view.result.current).toMatchObject({ empty: false, unreachable: false, disabled: false, settingsDisabled: false, saveDisabled: true });
  });

  it('orders pinned host catalog entries first and divides them from the rest', async () => {
    const view = mount({ ...service([]), catalog: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', models: ['m'] }, { id: 'p', label: 'P', defaultBaseUrl: 'https://p.test' }], pinnedProviderIds: ['p'] });
    await loaded(view);
    expect(view.result.current.rows.map(item => [item.id, item.divider])).toEqual([['p', false], ['a', true], ['b', false]]);
    expect(row(view, 'p')).toMatchObject({ hint: 'Uses https://p.test by default.', baseUrlPlaceholder: 'https://p.test', hasModels: false });
    expect(row(view, 'a')).toMatchObject({ hint: null, baseUrlPlaceholder: 'https://api.example.com', modelsId: 'jini-media-provider-models-a' });
    expect(row(view, 'b').hasModels).toBe(true);
    expect(view.result.current.empty).toBe(true);
  });

  it('shows and hides a credential, and marks edits unsaved', async () => {
    const view = mount({ ...service([]), catalog: [{ id: 'a', label: 'A' }] });
    await loaded(view);
    expect(row(view, 'a')).toMatchObject({ visible: false, credentialType: 'password', toggleLabel: 'A Show' });
    act(() => row(view, 'a').toggle());
    expect(row(view, 'a')).toMatchObject({ visible: true, credentialType: 'text', toggleLabel: 'A Hide' });
    act(() => row(view, 'a').toggle());
    expect(row(view, 'a').visible).toBe(false);
    act(() => row(view, 'a').onCredential(change('sk-1')));
    act(() => row(view, 'a').onModel(change('m-2')));
    expect(row(view, 'a')).toMatchObject({ statusLabel: 'Unsaved', credential: 'sk-1', model: 'm-2' });
    expect(view.result.current.saveDisabled).toBe(false);
  });

  it('writes the first credential and settings of a catalog provider the read never returned', async () => {
    let stored: MediaProvider[] = [];
    const upsert = (id: string, patch: Partial<MediaProvider>) => {
      const current = stored.find(item => item.id === id) ?? { id, label: id.toUpperCase(), configured: false };
      stored = [...stored.filter(item => item.id !== id), { ...current, ...patch }];
      return stored.find(item => item.id === id)!;
    };
    const port = {
      ...service([]),
      list: vi.fn(async () => stored.map(item => ({ ...item }))),
      saveSettings: vi.fn(async ({ id, baseUrl, model }: { id: string; baseUrl: string; model: string }) => upsert(id, { baseUrl, model })),
      saveCredential: vi.fn(async ({ id, credential }: { id: string; credential: string }) => upsert(id, { configured: true, apiKeyTail: credential.slice(-4) })),
      catalog: [{ id: 'a', label: 'A' }],
    };
    const view = mount(port);
    await loaded(view);
    act(() => row(view, 'a').onCredential(change('sk-5678')));
    act(() => view.result.current.save());
    await waitFor(() => expect(view.result.current.saved).toBe(true));
    expect(port.saveCredential).toHaveBeenCalledWith({ id: 'a', credential: 'sk-5678' }, { signal: expect.any(AbortSignal) });
    expect(row(view, 'a')).toMatchObject({ statusLabel: 'Saved (••••5678)', credential: '' });
    // A second catalog-only provider's first settings, saved alongside the now-known one.
    const second = mount({ ...port, catalog: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    await loaded(second);
    act(() => row(second, 'b').onModel(change('m-1')));
    act(() => second.result.current.save());
    await waitFor(() => expect(second.result.current.saved).toBe(true));
    expect(port.saveSettings).toHaveBeenCalledWith({ id: 'b', baseUrl: '', model: 'm-1' }, { signal: expect.any(AbortSignal) });
    expect(row(second, 'b').model).toBe('m-1');
    expect(port.removeCredential).not.toHaveBeenCalled();
  });

  it('flags a private base URL and blocks saving until it is fixed', async () => {
    const view = mount({ ...service([]), catalog: [{ id: 'a', label: 'A' }] });
    await loaded(view);
    act(() => row(view, 'a').onBaseUrl(change('ftp://files.test')));
    expect(row(view, 'a')).toMatchObject({ invalid: true, hintRole: 'alert', ariaInvalid: true, hintClassName: 'jini-field-hint jini-hint-error' });
    expect(row(view, 'a').hint).toContain('absolute http');
    expect(view.result.current.saveDisabled).toBe(true);
    act(() => row(view, 'a').onBaseUrl(change('https://api.a.test')));
    expect(row(view, 'a')).toMatchObject({ invalid: false, hintRole: undefined, ariaInvalid: undefined, hintClassName: 'jini-field-hint', hint: null });
    expect(view.result.current.saveDisabled).toBe(false);
  });

  it('saves the whole set through an atomic host in one call', async () => {
    const saveChanges = vi.fn(async () => [{ id: 'a', label: 'A', configured: true, apiKeyTail: '9999' }]);
    const port = { ...service([{ id: 'a', label: 'A', configured: false }]), saveChanges };
    const view = mount(port);
    await loaded(view);
    act(() => row(view, 'a').onCredential(change('sk-9999')));
    act(() => view.result.current.save());
    expect(view.result.current).toMatchObject({ saveLabel: 'Saving…', saveDisabled: true });
    await waitFor(() => expect(view.result.current.saved).toBe(true));
    expect(saveChanges).toHaveBeenCalledWith({ providers: { a: { apiKey: 'sk-9999' } } }, { signal: expect.any(AbortSignal) });
    expect(port.saveCredential).not.toHaveBeenCalled();
    expect(row(view, 'a').statusLabel).toBe('Saved (••••9999)');
    expect(view.result.current.saveLabel).toBe('Save changes');
  });

  it('saves sequentially on an older host: settings, then the credential, then a reread', async () => {
    const port = service([{ id: 'a', label: 'A', configured: false }, { id: 'b', label: 'B', configured: true, apiKeyTail: '1111', baseUrl: 'https://b.test', model: 'old' }, { id: 'c', label: 'C', configured: false }]);
    const view = mount(port);
    await loaded(view);
    act(() => row(view, 'a').onBaseUrl(change('https://a.test')));
    act(() => row(view, 'a').onCredential(change('sk-2222')));
    act(() => row(view, 'b').onModel(change('')));
    act(() => row(view, 'c').onModel(change('m-3')));
    act(() => view.result.current.save());
    await waitFor(() => expect(view.result.current.saved).toBe(true));
    expect(port.saveSettings.mock.calls.map(([args]) => args)).toEqual([{ id: 'a', baseUrl: 'https://a.test', model: '' }, { id: 'b', baseUrl: 'https://b.test', model: '' }, { id: 'c', baseUrl: '', model: 'm-3' }]);
    expect(port.saveCredential).toHaveBeenCalledWith({ id: 'a', credential: 'sk-2222' }, { signal: expect.any(AbortSignal) });
    expect(port.saveCredential).toHaveBeenCalledTimes(1);
    expect(port.removeCredential).not.toHaveBeenCalled();
    expect(row(view, 'a').statusLabel).toBeNull();
  });

  it('removes a cleared provider that held state and skips one that never did', async () => {
    const port = service([{ id: 'a', label: 'A', configured: true, apiKeyTail: '1111' }, { id: 'b', label: 'B', configured: false }]);
    const view = mount(port);
    await loaded(view);
    act(() => row(view, 'a').clear());
    await waitFor(() => expect(view.result.current.saved).toBe(true));
    expect(port.removeCredential).toHaveBeenCalledTimes(1);
    expect(port.removeCredential).toHaveBeenCalledWith({ id: 'a' }, { signal: expect.any(AbortSignal) });
    expect(view.result.current.empty).toBe(true);
  });

  it('removes a provider whose only saved state is an endpoint or a model', async () => {
    const port = service([{ id: 'a', label: 'A', configured: false, baseUrl: 'https://a.test' }, { id: 'b', label: 'B', configured: false, model: 'm' }]);
    const view = mount(port);
    await loaded(view);
    act(() => row(view, 'a').clear());
    await waitFor(() => expect(view.result.current.saved).toBe(true));
    act(() => row(view, 'b').clear());
    await waitFor(() => expect(port.removeCredential).toHaveBeenCalledTimes(2));
  });

  it('fails a settings change on a host without settings support', async () => {
    const { saveSettings: _drop, ...port } = service([{ id: 'a', label: 'A', configured: false }]);
    const view = mount(port);
    await loaded(view);
    expect(view.result.current.settingsDisabled).toBe(true);
    act(() => row(view, 'a').onModel(change('m')));
    act(() => view.result.current.save());
    await waitFor(() => expect(view.result.current.saveError).toBe(true));
  });

  it('fails the save when the follow-up reread is unreachable', async () => {
    const port = service([{ id: 'a', label: 'A', configured: false }]);
    const view = mount(port);
    await loaded(view);
    port.list.mockResolvedValueOnce(null as never);
    act(() => row(view, 'a').onCredential(change('sk-1')));
    act(() => view.result.current.save());
    await waitFor(() => expect(view.result.current.saveError).toBe(true));
  });

  it('labels a reload in flight', async () => {
    const view = mount(service([]));
    await loaded(view);
    act(() => view.result.current.reload());
    expect(view.result.current).toMatchObject({ reloadDisabled: true, reloadLabel: 'Reloading…' });
    await loaded(view);
    expect(view.result.current.reloadLabel).toBe('Reload');
  });
});
