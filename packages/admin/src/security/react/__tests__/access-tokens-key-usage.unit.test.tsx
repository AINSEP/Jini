import { TestChipField } from './chip-field.fixture.js';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { AdminKitProvider } from '../../../react/kit.js';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { useCredentialEditor } from '../hooks/CredentialEditor.hooks.js';
import { useSharedKeysDialog } from '../hooks/SharedKeysDialog.hooks.js';
import { AccessTokensTab } from '../tabs/AccessTokensTab.js';
import { SecurityPortsContext } from '../hooks/SecurityPorts.hooks.js';
import { createMemorySecurityApi } from '../../adapters/memory.js';
import type { CredentialProvider, CredentialSummary } from '../../models.js';
import type { SecurityApiPort } from '../../ports.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const providers: CredentialProvider[] = [{ kind: 'publish', id: 'zed', label: 'Zed hosting', vendorLabel: 'Zed', category: 'hosting', tokenField: 'token', fields: [] }];
const base = { configured: true, isDefault: false, createdAt: 'c', updatedAt: 'u' };
const custom = (patch: Partial<CredentialSummary>): CredentialSummary => ({ ...base, kind: 'custom', id: 'c1', providerId: '', label: 'Metrics', category: 'ops', baseUrl: 'https://m.example', ...patch });
const WRITE = ['security.read', 'system.publish', 'custom-credentials.write'];

function mount({ api, permissions = WRITE }: { api: SecurityApiPort; permissions?: string[] }) {
  return render(<AdminKitProvider kit={testAdminKit}><SecurityPortsContext.Provider value={{ securityApi: api }}>
    <AccessTokensTab ChipField={TestChipField} params={{}} permissions={permissions} useAccessTokensTabHook={useAccessTokensTab} useCredentialEditorHook={useCredentialEditor} useSharedKeysDialogHook={useSharedKeysDialog} />
  </SecurityPortsContext.Provider></AdminKitProvider>);
}
const article = (name: string) => screen.getByRole('heading', { level: 3, name }).closest('article') as HTMLElement;

describe('where a custom key is stored (SEC-12)', () => {
  it('a site-scoped key says "This site only" and offers no attach action', async () => {
    mount({ api: createMemorySecurityApi({ providers, rows: [custom({ scope: 'site' })], projectKeysAvailable: true }) });
    await screen.findByText('1 token saved');
    const row = article('Metrics');
    expect(within(row).getByText('This site only')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /on this site/ })).toBeNull();
    expect(within(row).queryByText('Access is revoked within 30 seconds.')).toBeNull();
  });

  it('a project key no site uses yet says so and offers to use it here', async () => {
    mount({ api: createMemorySecurityApi({ providers, rows: [custom({ scope: 'project', usedByThisSite: false })], projectKeysAvailable: true }) });
    await screen.findByText('1 token saved');
    const row = article('Metrics');
    expect(within(row).getByText('Project — not used by any site yet')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Use on this site — Metrics' })).toBeTruthy();
    expect(within(row).queryByRole('alert')).toBeNull();
  });

  it('a failed attach keeps the fixed failure on that key row only', async () => {
    const api = createMemorySecurityApi({ providers, rows: [custom({ scope: 'project', usedBy: ['blog'], usedByThisSite: false }), custom({ id: 'c2', label: 'Mail', scope: 'project', usedBy: [], usedByThisSite: false })], projectKeysAvailable: true });
    vi.spyOn(api as Required<SecurityApiPort>, 'useProjectKey').mockRejectedValueOnce(new Error('offline'));
    mount({ api });
    await screen.findByText('2 tokens saved');
    expect(within(article('Metrics')).getByText('Project — used by: blog')).toBeTruthy();
    fireEvent.click(within(article('Metrics')).getByRole('button', { name: 'Use on this site — Metrics' }));
    expect((await within(article('Metrics')).findByRole('alert')).textContent?.trim()).toBe('Changing where this key is used failed. Try again.');
    expect(within(article('Mail')).queryByRole('alert')).toBeNull();
  });
});

describe('removing a custom key (SEC-10)', () => {
  it('names the key itself in place of a vendor, with no revoke link and no last-token note', async () => {
    mount({ api: createMemorySecurityApi({ providers, rows: [custom({ label: 'Metrics' })] }) });
    await screen.findByText('1 token saved');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Metrics' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove credential' });
    expect(within(dialog).getByText('This deletes the saved copy of this Metrics token. It does NOT revoke the token on Metrics; it stays valid there until you revoke it yourself.')).toBeTruthy();
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(within(dialog).queryByText(/only saved/)).toBeNull();
  });
});

describe('default indicator without write access (SEC-10)', () => {
  it('shows which token is the default but offers no Make default to a read-only principal', async () => {
    const rows: CredentialSummary[] = [{ ...base, kind: 'publish', id: '1', providerId: 'zed', label: 'Deploy', isDefault: true }, { ...base, kind: 'publish', id: '2', providerId: 'zed', label: 'Backup' }];
    mount({ api: createMemorySecurityApi({ providers, rows }), permissions: ['security.read'] });
    await screen.findByText('2 tokens saved');
    expect(within(article('Deploy')).getByText('Default')).toBeTruthy();
    expect(within(article('Backup')).queryByText('Default')).toBeNull();
    expect(screen.queryByRole('button', { name: /Make default/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Backup' })).toBeNull();
  });
});

describe('custom key groups', () => {
  it('a custom key group has no add-another action: calling it opens no editor', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={testAdminKit}><SecurityPortsContext.Provider value={{ securityApi: createMemorySecurityApi({ providers, rows: [custom({})] }) }}>{children}</SecurityPortsContext.Provider></AdminKitProvider>;
    const view = renderHook(() => useAccessTokensTab({ params: {}, permissions: WRITE }), { wrapper });
    await waitFor(() => expect(view.result.current.groups.map(g => g.key)).toContain('custom:c1'));
    const group = view.result.current.groups.find(g => g.key === 'custom:c1')!;
    expect(group.canWrite).toBe(true);
    act(() => { group.add(); });
    expect(view.result.current.draft).toBeNull();
    // The tab's own "Add custom provider" action is the way to add one, and it does open an editor.
    act(() => { view.result.current.addCustom(); });
    expect(view.result.current.draft).toMatchObject({ kind: 'custom' });
  });
});
