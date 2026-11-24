import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { AdminKitProvider } from '../../../react/kit.js';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { OtherCredentialRow, OtherCredentialPlaceholder } from '../components/OtherCredentialRow.js';
import { SecurityPortsContext, SecurityTranslationContext, SecurityCredentialsHostContext, type SecurityCredentialsHost } from '../hooks/SecurityPorts.hooks.js';
import { createMemorySecurityApi, createMemoryOtherCredentials } from '../../adapters/memory.js';
import { englishSecurity, type SecurityTranslator } from '../../messages.en.js';
import type { SecurityRefreshSignal } from '../../ports.js';
import type { OtherCredentialSummary } from '../../models.js';
const PERMS = ['security.read', 'admin.assistant.manage', 'admin.integrations.manage'];
const mcp: OtherCredentialSummary = { store: 'external-mcp', id: 'srv', label: 'Server', category: 'ai', configured: true, supportsReplace: false, envNames: ['A', 'B', 'C'] };
const assistant: OtherCredentialSummary = { store: 'site-assistant', id: 'site-assistant', label: 'Assistant key', category: 'ai', configured: true, supportsReplace: true, tokenHint: { last4: 'ab12' } };
const links = { 'site-assistant': { href: '/assistant', label: 'Assistant screen' } };
function mount({ rows, host = {}, t = englishSecurity }: { rows: readonly OtherCredentialSummary[]; host?: SecurityCredentialsHost; t?: SecurityTranslator }) {
  const securityApi = createMemorySecurityApi({ providers: [] }); const otherCredentials = createMemoryOtherCredentials({ rows }); const list = vi.spyOn(otherCredentials, 'list');
  let translator = t;
  const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={testAdminKit}><SecurityPortsContext.Provider value={{ securityApi, otherCredentials }}>
    <SecurityTranslationContext.Provider value={translator}><SecurityCredentialsHostContext.Provider value={host}>{children}</SecurityCredentialsHostContext.Provider></SecurityTranslationContext.Provider></SecurityPortsContext.Provider></AdminKitProvider>;
  const view = renderHook(() => useAccessTokensTab({ params: {}, permissions: PERMS }), { wrapper });
  return { view, list, setT(next: SecurityTranslator) { translator = next; view.rerender(); } };
}
const settled = async (view: ReturnType<typeof mount>['view']) => { await waitFor(() => expect(view.result.current.loading).toBe(false)); await waitFor(() => expect(view.result.current.otherPlaceholders.length + view.result.current.otherRows.length).toBeGreaterThan(0)); };

describe('other credential stores in the Access tokens tab (SEC-13)', () => {
  it('keeps each settled empty store as a placeholder with its host deep link, and states row facts', async () => {
    const { view } = mount({ rows: [mcp, assistant], host: { otherStores: links } }); await settled(view);
    await waitFor(() => expect(view.result.current.otherPlaceholders.map(p => p.store)).toEqual(['admin-byok', 'media-provider']));
    expect(view.result.current.otherPlaceholders[0]).toMatchObject({ title: 'Admin assistant key (BYOK)', note: 'Not configured' });
    expect(view.result.current.otherRows.map(r => [r.row.id, r.fact, r.link?.href ?? null])).toEqual([['site-assistant', '••••ab12', '/assistant'], ['srv', '3 environment variables set', null]]);
  });
  it('words the env-name count with its plural form', async () => {
    const { view } = mount({ rows: [{ ...mcp, id: 'none', envNames: [] }, { ...mcp, id: 'one', envNames: ['A'] }] }); await settled(view);
    expect(view.result.current.otherRows.map(r => r.fact)).toEqual(['No environment variables set', '1 environment variable set']);
  });
  it('states each store\'s own removal consequence', async () => {
    const { view } = mount({ rows: [mcp, assistant] }); await settled(view);
    act(() => view.result.current.otherRows.find(r => r.row.store === 'external-mcp')!.remove());
    expect(view.result.current.removalBody).toMatch(/deletes the server and its saved credentials/);
    act(() => view.result.current.cancelRemove()); act(() => view.result.current.otherRows.find(r => r.row.store === 'site-assistant')!.remove());
    expect(view.result.current.removalBody).toMatch(/does not revoke the key at its provider/);
  });
});

describe('host refresh and live locale (SEC-14)', () => {
  it('a host refresh signal reloads the other stores once and a locale switch relabels without disposing', async () => {
    const listeners = new Set<() => void>(); const refreshSignal: SecurityRefreshSignal = { subscribe({ onRefresh }) { listeners.add(onRefresh); return () => { listeners.delete(onRefresh); }; } };
    const { view, list, setT } = mount({ rows: [mcp], host: { refreshSignal } }); await settled(view);
    expect(listeners.size).toBe(2); const before = list.mock.calls.length;
    await act(async () => { for (const l of [...listeners]) l(); });
    await waitFor(() => expect(list.mock.calls.length).toBe(before + 4));
    const reads = list.mock.calls.length;
    setT((key, vars) => `[fr] ${englishSecurity(key, vars)}`);
    expect(view.result.current.otherPlaceholders[0]?.title).toBe('[fr] Site assistant model key');
    expect(view.result.current.otherRows[0]?.fact).toBe('[fr] 3 environment variables set');
    expect(list.mock.calls.length).toBe(reads); expect(listeners.size).toBe(2);
    view.unmount(); expect(listeners.size).toBe(0);
  });
});

describe('OtherCredentialRow view', () => {
  it('renders the masked fact, the deep link, a per-row error and a private replacement field', () => {
    const item = { key: 'site-assistant:site-assistant', row: assistant, title: 'Assistant key', fact: '••••ab12', link: links['site-assistant'], canWrite: true, pending: false, error: 'Check the key and try again.', token: '', onToken: vi.fn(), replace: vi.fn(), remove: vi.fn() };
    render(<AdminKitProvider kit={testAdminKit}><OtherCredentialRow item={item} saving={false} t={englishSecurity} /><OtherCredentialPlaceholder item={{ key: 'admin-byok', store: 'admin-byok', title: 'Admin assistant key (BYOK)', note: 'Not configured' }} t={englishSecurity} /></AdminKitProvider>);
    expect(screen.getByText('••••ab12')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Manage on Assistant screen' }).getAttribute('href')).toBe('/assistant');
    expect(screen.getByText('Check the key and try again.')).toBeTruthy();
    expect(screen.getByLabelText('New key for Assistant key')).toBeTruthy(); expect((screen.getByLabelText('New key for Assistant key') as HTMLInputElement).type).toBe('password');
    expect(screen.getByText('Not configured')).toBeTruthy();
  });
});
