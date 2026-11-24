import { TestChipField } from './chip-field.fixture.js';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { AdminKitProvider } from '../../../react/kit.js';
import type { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { AccessTokensTab } from '../tabs/AccessTokensTab.js';
import { useCredentialEditor } from '../hooks/CredentialEditor.hooks.js';
import { useSharedKeysDialog } from '../hooks/SharedKeysDialog.hooks.js';
import { SecurityPortsContext } from '../hooks/SecurityPorts.hooks.js';
import { createMemorySecurityApi } from '../../adapters/memory.js';
import type { CredentialProvider, CredentialSummary } from '../../models.js';

const providers: CredentialProvider[] = [
  { kind: 'publish', id: 'zed', label: 'Zed hosting', vendorLabel: 'Zed', category: 'hosting', tokenField: 'token', fields: [] },
  { kind: 'source-control', id: 'git', label: 'Git host', vendorLabel: 'Git vendor', category: 'source-control', tokenField: 'token', fields: [] },
  { kind: 'publish', id: 'acme', label: 'Acme hosting', vendorLabel: 'Acme', category: 'hosting', tokenField: 'token', fields: [] },
];
const base = { configured: true, isDefault: true, createdAt: 'c', updatedAt: 'u' };
const rows: CredentialSummary[] = [
  { ...base, kind: 'publish', id: '1', providerId: 'zed', label: 'Deploy' },
  { ...base, kind: 'publish', id: '2', providerId: 'vanished', label: 'Old deploy' },
  { ...base, kind: 'custom', id: '3', providerId: '', label: 'Metrics', category: 'ops', baseUrl: 'https://m.example' },
];
const PERMS = ['security.read', 'system.publish'];
function wrapper(securityApi: ReturnType<typeof createMemorySecurityApi>) {
  return ({ children }: { children: ReactNode }) => <AdminKitProvider kit={testAdminKit}><SecurityPortsContext.Provider value={{ securityApi }}>{children}</SecurityPortsContext.Provider></AdminKitProvider>;
}

describe('useAccessTokensTab merged groups (SEC-9)', () => {
  it('orders saved groups first by category then label, keeps an unlisted provider row visible, and counts in a sentence', async () => {
    const view = renderHook(() => useAccessTokensTab({ params: {}, permissions: PERMS }), { wrapper: wrapper(createMemorySecurityApi({ providers, rows })) });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.groups.map(g => [g.provider.label, g.rows.map(r => r.row.id)])).toEqual([
      ['vanished', ['2']], ['Zed hosting', ['1']], ['Metrics', ['3']], ['Git host', []], ['Acme hosting', []]]);
    expect(view.result.current.groups[0]?.provider.unlisted).toBe(true);
    expect(view.result.current.countText).toBe('3 tokens saved');
    expect(view.result.current.hostingEmpty).toBe(false);
  });
  it('searching a not-connected provider by name still finds its group', async () => {
    const view = renderHook(() => useAccessTokensTab({ params: {}, permissions: PERMS }), { wrapper: wrapper(createMemorySecurityApi({ providers, rows })) });
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    view.result.current.onQuery({ value: 'acme' });
    await waitFor(() => expect(view.result.current.groups.map(g => g.provider.label)).toEqual(['Acme hosting']));
    expect(view.result.current.countText).toBe('0 of 3 tokens matching “acme”');
  });
  it('shows the empty-hosting hint when no hosting provider is available', async () => {
    render(<AccessTokensTab ChipField={TestChipField} params={{}} permissions={PERMS} useAccessTokensTabHook={useAccessTokensTab} useCredentialEditorHook={useCredentialEditor} useSharedKeysDialogHook={useSharedKeysDialog} />, { wrapper: wrapper(createMemorySecurityApi({ providers: [providers[1]!] })) });
    expect(await screen.findByText('Enable a hosting plugin to manage its access tokens.')).toBeTruthy();
    expect(screen.getByText('0 tokens saved')).toBeTruthy();
  });
});
