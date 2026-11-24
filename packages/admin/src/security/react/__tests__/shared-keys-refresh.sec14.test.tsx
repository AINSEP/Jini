import { TestChipField } from './chip-field.fixture.js';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { AdminKitProvider } from '../../../react/kit.js';
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { AdminCredentialCopySource } from '@jini-ai/core/contracts/site/api-security-api-types';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { useCredentialEditor } from '../hooks/CredentialEditor.hooks.js';
import { useSharedKeysDialog } from '../hooks/SharedKeysDialog.hooks.js';
import { AccessTokensTab } from '../tabs/AccessTokensTab.js';
import { SecurityCredentialsHostContext, SecurityPortsContext, type SecurityCredentialsHost } from '../hooks/SecurityPorts.hooks.js';
import { createMemorySecurityApi } from '../../adapters/memory.js';
import type { CredentialProvider } from '../../models.js';
import type { SecurityApiPort, SecurityRefreshSignal } from '../../ports.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const providers: CredentialProvider[] = [{ kind: 'publish', id: 'zed', label: 'Zed hosting', vendorLabel: 'Zed', category: 'hosting', tokenField: 'token', fields: [] }];
const sources: AdminCredentialCopySource[] = [{ siteId: 'shared-keys', name: 'Shared Keys', keys: [{ kind: 'custom', id: 'k1', label: 'Search', provider: 'search', worksFor: ['blog'] }] }];
const WRITE = ['security.read', 'system.publish', 'custom-credentials.write'];
function mount({ api, host }: { api: SecurityApiPort; host: SecurityCredentialsHost }) {
  return render(<AdminKitProvider kit={testAdminKit}><SecurityPortsContext.Provider value={{ securityApi: api }}><SecurityCredentialsHostContext.Provider value={host}>
    <AccessTokensTab ChipField={TestChipField} params={{}} permissions={WRITE} useAccessTokensTabHook={useAccessTokensTab} useCredentialEditorHook={useCredentialEditor} useSharedKeysDialogHook={useSharedKeysDialog} />
  </SecurityCredentialsHostContext.Provider></SecurityPortsContext.Provider></AdminKitProvider>);
}
/** A host refresh resource: the publication fires the subscription, as the host's content-refresh bus does. */
function hostBus() {
  const listeners = new Set<() => void>();
  const refreshSignal: SecurityRefreshSignal = { subscribe({ onRefresh }) { listeners.add(onRefresh); return () => { listeners.delete(onRefresh); }; } };
  const onCredentialsChanged = vi.fn(() => { for (const listener of [...listeners]) listener(); });
  return { refreshSignal, onCredentialsChanged };
}
async function grantSearchKey() {
  fireEvent.click(await screen.findByRole('button', { name: 'Use a saved key' }));
  const dialog = await screen.findByRole('dialog', { name: 'Use a saved key' });
  fireEvent.click(await within(dialog).findByRole('radio', { name: /Search/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Use this key on this site' }));
  return dialog;
}

describe('Shared Keys grant publishes the host refresh (SEC-14)', () => {
  it('calls onCredentialsChanged exactly once per grant, and the published refresh reloads the tab once', async () => {
    const api = createMemorySecurityApi({ providers, sharedKeys: { sources } }); const reads = vi.spyOn(api.custom, 'list'); const bus = hostBus();
    mount({ api, host: bus }); await screen.findByText('0 tokens saved'); const before = reads.mock.calls.length;
    const dialog = await grantSearchKey(); expect(await within(dialog).findByText('Granted to this site')).toBeTruthy();
    await waitFor(() => { expect(reads.mock.calls.length).toBe(before + 1); });
    expect(bus.onCredentialsChanged).toHaveBeenCalledTimes(1); expect(bus.onCredentialsChanged).toHaveBeenCalledWith({});
  });
  it('a failed grant publishes nothing', async () => {
    const api = createMemorySecurityApi({ providers, sharedKeys: { sources } }); vi.spyOn(api.sharedKeys!, 'grant').mockRejectedValue(new Error('offline')); const bus = hostBus();
    mount({ api, host: bus });
    const dialog = await grantSearchKey(); expect(await within(dialog).findByText(/Using the saved key failed/)).toBeTruthy();
    expect(bus.onCredentialsChanged).not.toHaveBeenCalled();
  });
  it('a host without a refresh subscription still gets the direct reload after its publication', async () => {
    const api = createMemorySecurityApi({ providers, sharedKeys: { sources } }); const reads = vi.spyOn(api.custom, 'list'); const onCredentialsChanged = vi.fn();
    mount({ api, host: { onCredentialsChanged } }); await screen.findByText('0 tokens saved'); const before = reads.mock.calls.length;
    const dialog = await grantSearchKey(); expect(await within(dialog).findByText('Granted to this site')).toBeTruthy();
    await waitFor(() => { expect(reads.mock.calls.length).toBe(before + 1); }); expect(onCredentialsChanged).toHaveBeenCalledTimes(1);
  });
  it('a host with no publication callback keeps the direct reload', async () => {
    const api = createMemorySecurityApi({ providers, sharedKeys: { sources } }); const reads = vi.spyOn(api.custom, 'list');
    mount({ api, host: {} }); await screen.findByText('0 tokens saved'); const before = reads.mock.calls.length;
    const dialog = await grantSearchKey(); expect(await within(dialog).findByText('Granted to this site')).toBeTruthy();
    await waitFor(() => { expect(reads.mock.calls.length).toBe(before + 1); });
  });
});
