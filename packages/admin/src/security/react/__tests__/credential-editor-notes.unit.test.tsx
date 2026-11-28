import { TestChipField } from './chip-field.fixture.js';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { AdminKitProvider } from '../../../react/kit.js';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { useCredentialEditor } from '../hooks/CredentialEditor.hooks.js';
import { useSharedKeysDialog } from '../hooks/SharedKeysDialog.hooks.js';
import { AccessTokensTab } from '../tabs/AccessTokensTab.js';
import { SecurityPortsContext } from '../hooks/SecurityPorts.hooks.js';
import { createMemorySecurityApi } from '../../adapters/memory.js';

afterEach(cleanup);
const WRITE = ['security.read', 'custom-credentials.write'];

async function openCustomEditor(projectKeysAvailable: boolean) {
  render(<AdminKitProvider kit={testAdminKit}><SecurityPortsContext.Provider value={{ securityApi: createMemorySecurityApi({ projectKeysAvailable }) }}>
    <AccessTokensTab ChipField={TestChipField} params={{}} permissions={WRITE} useAccessTokensTabHook={useAccessTokensTab} useCredentialEditorHook={useCredentialEditor} useSharedKeysDialogHook={useSharedKeysDialog} />
  </SecurityPortsContext.Provider></AdminKitProvider>);
  await screen.findByText('0 tokens saved');
  fireEvent.click(screen.getByRole('button', { name: 'Add custom provider' }));
  return screen.findByRole('dialog', { name: 'Add credential' });
}

describe('new custom key notes (SEC-11/SEC-12)', () => {
  it('says a new custom key is saved to the project when the server offers project keys', async () => {
    const dialog = await openCustomEditor(true);
    expect(within(dialog).getByText('Save to project and use on this site')).toBeTruthy();
    expect(within(dialog).queryByText('This site only')).toBeNull();
  });

  it('says a new custom key stays on this site when project keys are not offered', async () => {
    const dialog = await openCustomEditor(false);
    expect(within(dialog).getByText('This site only')).toBeTruthy();
    expect(within(dialog).queryByText('Save to project and use on this site')).toBeNull();
  });

  it('flags an additional host that is not an http(s) URL, and clears the flag once it is fixed', async () => {
    const dialog = await openCustomEditor(false);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    const hosts = within(dialog).getByLabelText('Additional hosts');
    fireEvent.change(hosts, { target: { value: 'ftp://files.example' } });
    expect(within(dialog).getByRole('alert').textContent).toBe('Each additional host must be a valid http:// or https:// URL.');
    fireEvent.change(hosts, { target: { value: 'https://files.example' } });
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });
});
