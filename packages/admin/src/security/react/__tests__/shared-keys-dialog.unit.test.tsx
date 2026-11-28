import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminCredentialCopySource } from '@jini-ai/core/contracts/site/api-security-api-types';
import { testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { AdminKitProvider } from '../../../react/kit.js';
import { SharedKeysDialog } from '../components/SharedKeysDialog.js';
import { useSharedKeysDialog } from '../hooks/SharedKeysDialog.hooks.js';
import { englishSecurity } from '../../messages.en.js';
import type { SharedKeysPort } from '../../ports.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const WRITE = ['custom-credentials.write'];

function mount(port: SharedKeysPort) {
  return render(<AdminKitProvider kit={testAdminKit}>
    <SharedKeysDialog port={port} permissions={WRITE} t={englishSecurity} onGranted={vi.fn()} useSharedKeysDialogHook={useSharedKeysDialog} />
  </AdminKitProvider>);
}

describe('Shared Keys picker states (SEC-12)', () => {
  it('shows the fixed load failure copy, never the error, and Cancel closes the picker', async () => {
    const port: SharedKeysPort = { list: vi.fn(async () => { throw new Error('server said fixture-detail'); }), grant: vi.fn() };
    mount(port);
    fireEvent.click(screen.getByRole('button', { name: 'Use a saved key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Use a saved key' });
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe("Couldn't load Shared Keys. Open Shared Keys and try again. Secret values omitted.");
    expect(dialog.textContent).not.toContain('fixture-detail');
    // A failed read is not "no keys": the empty-state copy stays away.
    expect(within(dialog).queryByText(englishSecurity('sharedKeysEmpty'))).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(port.grant).not.toHaveBeenCalled();
  });

  it('says no saved keys are available when the Shared Keys group is empty', async () => {
    const empty: AdminCredentialCopySource = { siteId: 'shared-keys', name: 'Shared Keys', keys: [] };
    mount({ list: vi.fn(async () => [empty]), grant: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Use a saved key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Use a saved key' });
    expect(await within(dialog).findByText('No saved keys are available. Use Add credential to enter a new key.')).toBeTruthy();
    expect(within(dialog).queryAllByRole('radio')).toHaveLength(0);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect((within(dialog).getByRole('button', { name: 'Use this key on this site' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
