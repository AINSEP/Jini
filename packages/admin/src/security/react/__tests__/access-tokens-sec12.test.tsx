import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { AdminKitProvider } from '../../../react/kit.js';
import type { ReactNode } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { AdminCredentialCopySource } from '@jini-ai/core/contracts/site/api-security-api-types';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { useCredentialEditor } from '../hooks/CredentialEditor.hooks.js';
import { useSharedKeysDialog } from '../hooks/SharedKeysDialog.hooks.js';
import { AccessTokensTab } from '../tabs/AccessTokensTab.js';
import { SecurityPortsContext, SecurityTranslationContext } from '../hooks/SecurityPorts.hooks.js';
import { createMemorySecurityApi } from '../../adapters/memory.js';
import { createMemoryOtherCredentials } from '../../adapters/memory.js';
import type { CredentialProvider, CredentialSummary } from '../../models.js';
import type { SecurityApiPort } from '../../ports.js';

afterEach(cleanup);
const SECRET = 'fixture-secret-value';
const providers: CredentialProvider[] = [{ kind: 'publish', id: 'zed', label: 'Zed hosting', vendorLabel: 'Zed', category: 'hosting', tokenField: 'token', fields: [] }];
const base = { configured: true, isDefault: true, createdAt: 'c', updatedAt: 'u' };
const projectRow: CredentialSummary = { ...base, isDefault: false, kind: 'custom', id: 'p1', providerId: '', label: 'Metrics', category: 'ops', baseUrl: 'https://m.example', scope: 'project', usedBy: ['blog', 'shop'], usedByThisSite: true, tokenHint: { length: 40, last4: 'ab12' } };
const sources: AdminCredentialCopySource[] = [{ siteId: 'shared-keys', name: 'Shared Keys', keys: [
  { kind: 'custom', id: 'k1', label: 'Search', provider: 'search', worksFor: ['blog'] }, { kind: 'custom', id: 'k2', label: 'Mail', provider: null, locked: 'Locked key' },
  { kind: 'custom', id: 'k3', label: 'Elsewhere', provider: 'x', siteName: 'Blog', omittedCount: 2 }] }];
const WRITE = ['security.read', 'system.publish', 'custom-credentials.write'];
function mount({ api, permissions = WRITE, other, t }: { api: SecurityApiPort; permissions?: string[]; other?: ReturnType<typeof createMemoryOtherCredentials>; t?: (key: string, vars?: Record<string, string | number>) => string }, params: Record<string, unknown> = {}) {
  const ports = { securityApi: api, ...(other ? { otherCredentials: other } : {}) };
  const tree = <AccessTokensTab params={params} permissions={permissions} useAccessTokensTabHook={useAccessTokensTab} useCredentialEditorHook={useCredentialEditor} useSharedKeysDialogHook={useSharedKeysDialog} />;
  return render(<AdminKitProvider kit={testAdminKit}><SecurityPortsContext.Provider value={ports}>{t ? <SecurityTranslationContext.Provider value={t}>{tree}</SecurityTranslationContext.Provider> : tree}</SecurityPortsContext.Provider></AdminKitProvider>);
}

describe('Shared Keys dialog (SEC-12)', () => {
  it('needs the custom write grant and a host Shared Keys port', async () => {
    mount({ api: createMemorySecurityApi({ providers, sharedKeys: { sources } }), permissions: ['security.read', 'system.publish'] });
    await screen.findByText('0 tokens saved'); expect(screen.queryByRole('button', { name: 'Use a saved key' })).toBeNull(); cleanup();
    mount({ api: createMemorySecurityApi({ providers }) });
    await screen.findByText('0 tokens saved'); expect(screen.queryByRole('button', { name: 'Use a saved key' })).toBeNull();
  });
  it('lists metadata, keeps locked keys unselectable, grants one key and shows the result', async () => {
    const api = createMemorySecurityApi({ providers, sharedKeys: { sources } }); const grant = vi.spyOn(api.sharedKeys!, 'grant');
    mount({ api });
    fireEvent.click(await screen.findByRole('button', { name: 'Use a saved key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Use a saved key' });
    expect(within(dialog).getByRole('radio', { name: /Mail/ })).toBeDisabled();
    expect(within(dialog).getByText('Blog: 2 more not shown')).toBeTruthy();
    expect(dialog.querySelector('[data-jini-part="security.shared-keys.list"]')).not.toBeNull();
    const submit = within(dialog).getByRole('button', { name: 'Use this key on this site' }); expect(submit).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Search · search · blog/ }));
    fireEvent.click(submit); fireEvent.click(submit);
    expect(await within(dialog).findByText('Granted to this site')).toBeTruthy();
    expect(grant).toHaveBeenCalledTimes(1);
    expect(dialog.querySelector('[data-jini-part="security.shared-keys.results"]')).not.toBeNull();
  });
  it('a failed grant result never reads as granted', async () => {
    const api = createMemorySecurityApi({ providers, sharedKeys: { sources } }); vi.spyOn(api.sharedKeys!, 'grant').mockResolvedValue([{ kind: 'custom', id: 'k1', status: 'failed', reasonCode: 'conflict' }]);
    mount({ api });
    fireEvent.click(await screen.findByRole('button', { name: 'Use a saved key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Use a saved key' });
    fireEvent.click(await within(dialog).findByRole('radio', { name: /Search/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this key on this site' }));
    expect(await within(dialog).findByText(/Using the saved key failed/)).toBeTruthy();
    expect(within(dialog).queryByText('Granted to this site')).toBeNull();
  });
});

describe('project keys, hints and rotation (SEC-12)', () => {
  it('shows the masked hint, where a project key is used, and toggles its use on this site', async () => {
    const api = createMemorySecurityApi({ providers, rows: [projectRow], projectKeysAvailable: true }); const use = vi.spyOn(api, 'useProjectKey');
    mount({ api });
    expect(await screen.findByText('…ab12, 40 chars')).toBeTruthy();
    expect(screen.getByText('Project — used by: blog, shop')).toBeTruthy();
    expect(screen.getByText('Access is revoked within 30 seconds.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop using on this site — Metrics' }));
    await waitFor(() => expect(use).toHaveBeenCalledWith({ keyId: 'p1', use: false }, expect.anything()));
    expect(await screen.findByRole('button', { name: 'Use on this site — Metrics' })).toBeTruthy();
  });
  it('warns before replacing a key other sites use and states where a new custom key is saved', async () => {
    mount({ api: createMemorySecurityApi({ providers, rows: [projectRow], projectKeysAvailable: true }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Metrics' }));
    expect(within(await screen.findByRole('dialog', { name: 'Edit credential' })).getByText('Used by 1 other site; it will use the new token too.')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add custom provider' }));
    expect(within(await screen.findByRole('dialog', { name: 'Add credential' })).getByText('Save to project and use on this site')).toBeTruthy();
  });
  it('never renders a secret from a leaky row', async () => {
    const log = vi.spyOn(console, 'error');
    const leaky = { ...projectRow, token: SECRET } as CredentialSummary;
    const view = mount({ api: createMemorySecurityApi({ providers, rows: [leaky], projectKeysAvailable: true }) });
    await screen.findByText('…ab12, 40 chars');
    expect(view.container.innerHTML).not.toContain(SECRET);
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET);
  });
});

describe('SEC-9 leftovers', () => {
  it('labels a second add "Add another", links the host plugins page, and translates the count', async () => {
    const rows: CredentialSummary[] = [{ ...base, kind: 'publish', id: '1', providerId: 'zed', label: 'Deploy' }];
    mount({ api: createMemorySecurityApi({ providers, rows }) });
    expect(await screen.findByRole('button', { name: 'Add another Zed hosting token' })).toBeTruthy(); cleanup();
    const t = (key: string, vars: Record<string, string | number> = {}) => key === 'tokenCountMany' ? `${vars.count} gespeichert` : key === 'hostingEmptyLink' ? 'Erweiterungen' : key;
    mount({ api: createMemorySecurityApi({ providers: [] }), t }, { pluginsHref: '/host/plugins' });
    expect(await screen.findByText('0 gespeichert')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Erweiterungen' }).getAttribute('href')).toBe('/host/plugins');
  });
  it('merges other credential stores into the shared ordering', async () => {
    const other = createMemoryOtherCredentials({ rows: [{ store: 'media-provider', id: 'img', label: 'Image model', category: 'media', configured: true, supportsReplace: true }] });
    const rows: CredentialSummary[] = [{ ...base, kind: 'publish', id: '1', providerId: 'zed', label: 'Deploy' }, { ...projectRow, category: 'ai', label: 'Assistant' }];
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={testAdminKit}><SecurityPortsContext.Provider value={{ securityApi: createMemorySecurityApi({ providers, rows }), otherCredentials: other }}>{children}</SecurityPortsContext.Provider></AdminKitProvider>;
    const view = renderHook(() => useAccessTokensTab({ params: {}, permissions: WRITE }), { wrapper });
    await waitFor(() => expect(view.result.current.sections.length).toBe(3));
    expect(view.result.current.sections.map(s => [s.type, s.provider.label])).toEqual([['access', 'Zed hosting'], ['other', 'Image model'], ['access', 'Assistant']]);
  });
});
