import { TestChipField } from './chip-field.fixture.js';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { AdminKitProvider } from '../../../react/kit.js';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { useCredentialEditor } from '../hooks/CredentialEditor.hooks.js';
import { useSharedKeysDialog } from '../hooks/SharedKeysDialog.hooks.js';
import { AccessTokensTab } from '../tabs/AccessTokensTab.js';
import { SecurityCredentialsHostContext, SecurityPortsContext } from '../hooks/SecurityPorts.hooks.js';
import { createMemoryOtherCredentials, createMemorySecurityApi } from '../../adapters/memory.js';
import type { OtherCredentialSummary } from '../../models.js';

afterEach(cleanup);
const media: OtherCredentialSummary = { store: 'media-provider', id: 'img', label: 'Image model', category: 'media', configured: true, supportsReplace: true };

function mount() {
  const ports = { securityApi: createMemorySecurityApi({}), otherCredentials: createMemoryOtherCredentials({ rows: [media] }) };
  const host = { otherStores: { 'admin-byok': { href: '/host/owner', label: 'Owner settings' } } };
  return render(<AdminKitProvider kit={testAdminKit}><SecurityPortsContext.Provider value={ports}><SecurityCredentialsHostContext.Provider value={host}>
    <AccessTokensTab ChipField={TestChipField} params={{}} permissions={['security.read', 'admin.integrations.manage']}
      useAccessTokensTabHook={useAccessTokensTab} useCredentialEditorHook={useCredentialEditor} useSharedKeysDialogHook={useSharedKeysDialog} />
  </SecurityCredentialsHostContext.Provider></SecurityPortsContext.Provider></AdminKitProvider>);
}
const article = (name: string) => screen.getByRole('heading', { level: 3, name }).closest('article') as HTMLElement;

describe('other credential stores rendered in the tab (SEC-13)', () => {
  it('renders a configured other-store row as its own card', async () => {
    mount();
    const heading = await screen.findByRole('heading', { level: 3, name: 'Image model' });
    const row = heading.closest('article') as HTMLElement;
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Replace Image model' })).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Remove Image model' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove credential' });
    // The other store's own consequence, not the access-token body or the generic fallback.
    expect(dialog.textContent).toContain('This deletes the saved copy of this key. It does not revoke the key at its provider; it stays valid there until you revoke it yourself.');
    expect(dialog.textContent).not.toContain('Removing this saved connection cannot revoke the token at its provider.');
    expect(within(dialog).queryByRole('link')).toBeNull();
  });

  it('links an empty store to the screen that owns it only when the host gave a link', async () => {
    mount();
    await screen.findByRole('heading', { level: 3, name: 'Admin assistant key (BYOK)' });
    const byok = article('Admin assistant key (BYOK)');
    expect(within(byok).getByText('Not configured')).toBeTruthy();
    expect(within(byok).getByRole('link', { name: 'Manage on Owner settings' }).getAttribute('href')).toBe('/host/owner');
    const mcp = article('External MCP servers');
    expect(within(mcp).getByText('Not configured')).toBeTruthy();
    expect(within(mcp).queryByRole('link')).toBeNull();
  });
});
