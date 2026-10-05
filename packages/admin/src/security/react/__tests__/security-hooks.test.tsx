import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { useRootKeyTab } from '../hooks/RootKeyTab.hooks.js';
import { SecurityPortsContext, noOtherCredentials, unavailableRootKey, useSecurityPorts } from '../hooks/SecurityPorts.hooks.js';
import type { SecurityPorts } from '../hooks/SecurityPorts.hooks.js';
import { createMemoryOtherCredentials, createMemoryRootKey, createMemorySecurityApi } from '../../adapters/memory.js';
import type { CredentialProvider, CredentialSummary, OtherCredentialSummary, RootKeyStatus } from '../../models.js';

const providers: CredentialProvider[] = [
  { kind: 'source-control', id: 'git', label: 'Git host', vendorLabel: 'Git vendor', category: 'source-control', tokenField: 'token', fields: [] },
  { kind: 'publish', id: 'cdn', label: 'CDN', vendorLabel: 'CDN vendor', category: 'hosting', tokenField: 'token', fields: [] },
];
const rows: CredentialSummary[] = [
  { kind: 'source-control', id: '1', providerId: 'git', label: 'default', configured: true, isDefault: false, createdAt: 'today', updatedAt: 'today' },
  { kind: 'publish', id: '2', providerId: 'cdn', label: 'Deploy', configured: true, isDefault: true, createdAt: 'today', updatedAt: 'today' },
];
const others: OtherCredentialSummary[] = [{ store: 'admin-byok', id: 'k', label: 'Model key', category: 'ai', configured: true, supportsReplace: true }];
const WRITE = ['security.read', 'source-control.credentials.write', 'system.publish', 'custom-credentials.write', 'admin.assistant.manage'];

function wrap(ports: SecurityPorts) {
  return ({ children }: { children: ReactNode }) => <SecurityPortsContext.Provider value={ports}>{children}</SecurityPortsContext.Provider>;
}
function mountTokens({ permissions = WRITE, otherCredentials = createMemoryOtherCredentials({ rows: others }), securityApi = createMemorySecurityApi({ providers, rows }) }: {
  permissions?: string[]; otherCredentials?: SecurityPorts['otherCredentials'] | null; securityApi?: SecurityPorts['securityApi'];
} = {}) {
  let first: ReturnType<typeof useAccessTokensTab> | undefined;
  const view = renderHook(() => { const vm = useAccessTokensTab({ params: {}, permissions }); first ??= vm; return vm; },
    { wrapper: wrap({ securityApi, ...(otherCredentials ? { otherCredentials } : {}) }) });
  return { ...view, securityApi, otherCredentials, first: () => first! };
}
const row = (view: { result: { current: ReturnType<typeof useAccessTokensTab> } }, id: string) => view.result.current.rows.find(item => item.row.id === id)!;
const settled = (view: { result: { current: { loading: boolean; saving: boolean } } }) =>
  waitFor(() => expect(view.result.current.loading || view.result.current.saving).toBe(false));

describe('unavailable security ports', () => {
  it('list nothing and refuse every other call', async () => {
    await expect(noOtherCredentials.list({ store: 'admin-byok' })).resolves.toEqual([]);
    await expect(noOtherCredentials.replace({ store: 'admin-byok', id: 'k', token: 't' })).rejects.toThrow('Unavailable');
    await expect(unavailableRootKey.generate({})).rejects.toThrow('Unavailable');
  });

  it('fails loudly outside a security provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSecurityPorts({}))).toThrow('React scope unavailable: security');
    vi.mocked(console.error).mockRestore();
  });
});

describe('useAccessTokensTab', () => {
  it('lists saved tokens, other stores and addable providers with their write grants', async () => {
    const view = mountTokens({ permissions: ['security.read', 'source-control.credentials.write'] });
    expect(view.first()).toMatchObject({ loading: true, saving: false, rows: [], otherRows: [], providers: [], total: 0, matched: 0, draft: null, errors: [] });
    await settled(view);
    expect(view.result.current.rows.map(r => [r.label, r.canWrite])).toEqual([['Deploy', false], ['Git host token', true]]);
    expect(view.result.current.otherRows.map(r => [r.row.id, r.canWrite, r.token])).toEqual([['k', false, '']]);
    expect(view.result.current.providers.map(p => [p.provider.id, p.canWrite])).toEqual([['git', true], ['cdn', false]]);
    expect(view.result.current).toMatchObject({ denied: false, total: 3, matched: 3, canAddCustom: false, query: '', category: 'all' });
  });

  it('is denied without the read grant', () => {
    expect(mountTokens({ permissions: [] }).result.current.denied).toBe(true);
  });

  it('filters rows and providers by search and category while the total stays global', async () => {
    const view = mountTokens();
    await settled(view);
    act(() => view.result.current.onCategory({ value: 'hosting' }));
    expect(view.result.current).toMatchObject({ category: 'hosting', total: 3, matched: 3 });
    expect(view.result.current.rows.map(r => r.row.id)).toEqual(['2']);
    expect(view.result.current.providers.map(p => p.provider.id)).toEqual(['cdn']);
    expect(view.result.current.otherRows).toEqual([]);
    act(() => { view.result.current.onCategory({ value: 'all' }); view.result.current.onQuery({ value: ' GIT ' }); });
    expect(view.result.current).toMatchObject({ query: ' GIT ', matched: 1 });
    expect(view.result.current.providers.map(p => p.provider.id)).toEqual(['git']);
  });

  it('opens editors for a saved row, a provider and a custom token', async () => {
    const view = mountTokens();
    await settled(view);
    act(() => row(view, '2').edit());
    expect(view.result.current.draft).toMatchObject({ kind: 'publish', id: '2', label: 'Deploy' });
    act(() => view.result.current.controller!.cancel({}));
    act(() => view.result.current.providers[0]!.add());
    expect(view.result.current.draft).toMatchObject({ kind: 'source-control', providerId: 'git' });
    act(() => view.result.current.controller!.cancel({}));
    act(() => view.result.current.addCustom());
    expect(view.result.current.draft).toMatchObject({ kind: 'custom' });
    expect(view.result.current.canAddCustom).toBe(true);
  });

  it('makes a row the default', async () => {
    const view = mountTokens();
    await settled(view);
    const update = vi.spyOn(view.securityApi.sourceControl, 'update');
    await act(async () => row(view, '1').makeDefault());
    expect(update).toHaveBeenCalledWith({ id: '1', patch: { isDefault: true } }, { signal: expect.any(AbortSignal) });
  });

  it('removes a saved token only after confirmation', async () => {
    const view = mountTokens();
    await settled(view);
    act(() => row(view, '2').remove());
    expect(view.result.current.removal).toMatchObject({ type: 'access', row: { id: '2' } });
    act(() => view.result.current.cancelRemove());
    expect(view.result.current.removal).toBeNull();
    act(() => row(view, '2').remove());
    await act(async () => view.result.current.confirmRemove());
    await settled(view);
    expect(view.result.current).toMatchObject({ removal: null, total: 2 });
  });

  it('replaces and removes another store credential', async () => {
    const view = mountTokens();
    await settled(view);
    const replace = vi.spyOn(view.otherCredentials!, 'replace');
    act(() => view.result.current.otherRows[0]!.onToken({ value: 'sk-new' }));
    expect(view.result.current.otherRows[0]!.token).toBe('sk-new');
    await act(async () => view.result.current.otherRows[0]!.replace());
    expect(replace).toHaveBeenCalledWith({ store: 'admin-byok', id: 'k', token: 'sk-new' }, { signal: expect.any(AbortSignal) });
    act(() => view.result.current.otherRows[0]!.remove());
    expect(view.result.current.removal).toMatchObject({ type: 'other' });
    await act(async () => view.result.current.confirmRemove());
    await settled(view);
    expect(view.result.current).toMatchObject({ removal: null, otherRows: [] });
  });

  it('keeps the removal open and throws when the store refuses it', async () => {
    const otherCredentials = { ...createMemoryOtherCredentials({ rows: others }), remove: async () => { throw new Error('locked'); } };
    const view = mountTokens({ otherCredentials });
    await settled(view);
    act(() => view.result.current.otherRows[0]!.remove());
    await act(async () => { await expect(view.result.current.confirmRemove()).rejects.toThrow('Unable to remove credential'); });
    expect(view.result.current.removal).toMatchObject({ type: 'other' });
    expect(view.result.current.errors).toEqual(['Unable to update credential']);
  });

  it('will not dismiss a removal while a write is in flight', async () => {
    let release!: () => void;
    const securityApi = createMemorySecurityApi({ providers, rows });
    const view = mountTokens({ securityApi: { ...securityApi, publish: { ...securityApi.publish, remove: () => new Promise<void>(resolve => { release = resolve; }) } } });
    await settled(view);
    act(() => row(view, '2').remove());
    let done!: Promise<void>;
    act(() => { done = view.result.current.confirmRemove(); });
    expect(view.result.current.saving).toBe(true);
    act(() => view.result.current.cancelRemove());
    expect(view.result.current.removal).not.toBeNull();
    await act(async () => { release(); await done; });
  });

  it('does nothing when asked to confirm without a pending removal', async () => {
    const view = mountTokens();
    await settled(view);
    await expect(view.result.current.confirmRemove()).resolves.toBeUndefined();
  });

  it('collects catalog, store and other-store failures', async () => {
    const securityApi = createMemorySecurityApi({ providers, rows });
    const view = mountTokens({
      securityApi: { ...securityApi, providers: async () => { throw new Error('down'); }, custom: { ...securityApi.custom, list: async () => { throw new Error('down'); } } },
      otherCredentials: { ...noOtherCredentials, list: async () => { throw new Error('down'); } },
    });
    await settled(view);
    expect(view.result.current.errors).toEqual(['Provider catalog unavailable', 'Credential store unavailable', ...Array(4).fill('Credential store unavailable')]);
  });

  it('reloads both stores, and lists no other stores when the host has none', async () => {
    const view = mountTokens({ otherCredentials: null });
    await settled(view);
    expect(view.result.current.otherRows).toEqual([]);
    const list = vi.spyOn(view.securityApi, 'providers');
    act(() => view.result.current.reload());
    await settled(view);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('keeps first-render handlers inert before the controllers exist', async () => {
    const view = mountTokens();
    const first = view.first();
    expect(first.controller).toBeNull();
    first.addCustom(); first.onQuery({ value: 'x' }); first.onCategory({ value: 'ai' }); first.reload();
    await settled(view);
    expect(view.result.current).toMatchObject({ query: '', category: 'all', draft: null });
    act(() => view.result.current.rows[0]!.remove());
    const stale = view.result.current;
    view.unmount();
    await expect(stale.confirmRemove()).rejects.toThrow('Unable to remove credential');
  });
});

const lockedStatus: RootKeyStatus = { active: false, source: 'none', state: 'missing-with-data', keyFilePath: '/key', runtimeMode: 'local' };
function mountRoot({ permissions = ['admin.security.tokens.manage'], rootKey = createMemoryRootKey({}), params = {} }: {
  permissions?: string[]; rootKey?: SecurityPorts['rootKey'] | null; params?: Record<string, unknown>;
} = {}) {
  let first: ReturnType<typeof useRootKeyTab> | undefined;
  const view = renderHook(() => { const vm = useRootKeyTab({ params, permissions }); first ??= vm; return vm; },
    { wrapper: wrap({ securityApi: createMemorySecurityApi({}), ...(rootKey ? { rootKey } : {}) }) });
  return { ...view, rootKey, first: () => first! };
}

describe('useRootKeyTab', () => {
  it('is denied and refuses status without a host root key', async () => {
    const view = mountRoot({ rootKey: null });
    expect(view.result.current.denied).toBe(true);
    await waitFor(() => expect(view.result.current.error).toBe('Root key status unavailable'));
  });

  it('is denied without the manage grant', () => {
    const view = mountRoot({ permissions: [] });
    expect(view.result.current.denied).toBe(true);
  });

  it('offers to generate a missing key and reports it ready', async () => {
    const view = mountRoot({ params: { scopeNotice: 'Host notice' } });
    expect(view.first()).toMatchObject({ loading: true, saving: false, token: '', confirm: '', confirming: false, locked: false, canGenerate: false, canConfirm: false });
    await waitFor(() => expect(view.result.current.canGenerate).toBe(true));
    expect(view.result.current).toMatchObject({ denied: false, scopeNotice: 'Host notice', locked: false });
    await act(async () => view.result.current.generate());
    await waitFor(() => expect(view.result.current.result).toBe('Root key ready'));
    expect(view.result.current).toMatchObject({ canGenerate: false, status: { active: true } });
  });

  it('uses the default scope notice and unlocks a locked key with a token', async () => {
    const view = mountRoot({ rootKey: createMemoryRootKey({ status: lockedStatus }) });
    expect(view.result.current.scopeNotice).toBe('This key protects saved credentials. Keep its backup separate from the database.');
    await waitFor(() => expect(view.result.current.locked).toBe(true));
    expect(view.result.current.canGenerate).toBe(false);
    act(() => view.result.current.onToken({ value: 'a'.repeat(64) }));
    expect(view.result.current.token).toBe('a'.repeat(64));
    await act(async () => view.result.current.unlock());
    await waitFor(() => expect(view.result.current.result).toBe('Unlocked. Saved credentials work again.'));
  });

  it('previews, cancels and then confirms a fresh start with the typed phrase', async () => {
    const view = mountRoot({ rootKey: createMemoryRootKey({ status: lockedStatus }) });
    await waitFor(() => expect(view.result.current.locked).toBe(true));
    await act(async () => view.result.current.previewFresh());
    await waitFor(() => expect(view.result.current.confirming).toBe(true));
    expect(view.result.current.preview).toMatchObject({ removes: 0 });
    act(() => view.result.current.cancelFresh());
    expect(view.result.current).toMatchObject({ confirming: false, preview: null });
    await act(async () => view.result.current.previewFresh());
    await waitFor(() => expect(view.result.current.confirming).toBe(true));
    act(() => view.result.current.onConfirmText({ value: 'start fresh' }));
    expect(view.result.current.canConfirm).toBe(false);
    await act(async () => { await expect(view.result.current.confirmFresh()).rejects.toThrow('Recovery was not completed'); });
    act(() => view.result.current.onConfirmText({ value: 'START FRESH' }));
    expect(view.result.current.canConfirm).toBe(true);
    await act(async () => view.result.current.confirmFresh());
    await waitFor(() => expect(view.result.current.result).toBe('Done. Re-enter removed credentials.'));
  });

  it('keeps first-render handlers inert before the controller exists', async () => {
    const view = mountRoot();
    const first = view.first();
    first.onToken({ value: 'x' }); first.onConfirmText({ value: 'x' }); first.generate(); first.unlock(); first.previewFresh(); first.cancelFresh();
    await expect(first.confirmFresh()).rejects.toThrow('Recovery was not completed');
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current).toMatchObject({ token: '', confirm: '', result: null });
  });
});
