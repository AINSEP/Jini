// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCredentialCopySource } from '@jini-ai/core/contracts/site/api-security-api-types';
import { AdminKitProvider } from '../../../react/kit.js';
import { fakeAdminKit } from '../../../react/testing-kit.js';
import { CopyKeysDialog } from '../CopyKeysDialog.js';
import { useCopyKeys, type CopyKeysArgs, type CopyKeysPort } from '../hooks/use-copy-keys.hooks.js';

const t = (key: string) => key;
const policy = (sourceSiteId = 'pool-a'): CopyKeysArgs['sharedKeys'] => ({
  sourceSiteId, loadFailed: 'Picker load failed; secret values omitted.', grantFailed: 'Grant failed; secret values omitted.',
});
const SOURCES: AdminCredentialCopySource[] = [
  { siteId: 'pool-a', name: 'Pool A', keys: [
    { kind: 'vendor', id: 'one', label: 'Main', provider: 'OpenAI', worksFor: [] },
    { kind: 'custom', id: 'two', label: 'Work', provider: 'Example', worksFor: [] },
  ] },
  { siteId: 'other-site', name: 'Other site', keys: [{ kind: 'vendor', id: 'foreign', label: 'Foreign', provider: 'OpenAI' }] },
];

function fakePort(overrides: Partial<CopyKeysPort> = {}): CopyKeysPort {
  return {
    listCredentialCopySources: vi.fn().mockResolvedValue({ sources: SOURCES }),
    copyCredentials: vi.fn().mockResolvedValue({ results: [{ kind: 'vendor', id: 'one', status: 'granted' }] }),
    ...overrides,
  };
}

function Harness(props: Omit<CopyKeysArgs, 't'>) {
  const dialog = useCopyKeys({ t, ...props });
  return <><button onClick={dialog.show}>Open</button><CopyKeysDialog dialog={dialog} t={t} /></>;
}

function mount(props: Omit<CopyKeysArgs, 't'>) {
  render(<AdminKitProvider kit={fakeAdminKit()}><Harness {...props} /></AdminKitProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
}

describe('saved-key picker', () => {
  it('approves one selected reference without other-site inventory and notifies once', async () => {
    const port = fakePort();
    const onGranted = vi.fn();
    mount({ port, onGranted, sharedKeys: policy() });
    fireEvent.click(await screen.findByRole('radio', { name: 'Main · OpenAI' }));
    expect(screen.getAllByRole('radio').map(radio => radio.getAttribute('value'))).toEqual(['one', 'two']);
    expect(screen.queryByText(/Foreign/)).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use this key on this site' }));
    expect(await screen.findByText('Granted to this site')).toBeVisible();
    expect(port.copyCredentials).toHaveBeenCalledTimes(1);
    expect(port.copyCredentials).toHaveBeenCalledWith({ sourceSiteId: 'pool-a', ids: ['one'], overwrite: false });
    expect(onGranted).toHaveBeenCalledTimes(1);
    expect(onGranted).toHaveBeenCalledWith({});
  });

  it('shows only the redacted grant failure and never notifies on rejection', async () => {
    const port = fakePort({ copyCredentials: vi.fn().mockRejectedValue(new Error('sk-live-SECRET-VALUE')) });
    const onGranted = vi.fn();
    mount({ port, onGranted, sharedKeys: policy() });
    fireEvent.click(await screen.findByRole('radio', { name: 'Main · OpenAI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this key on this site' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Grant failed; secret values omitted.');
    expect(screen.queryByText(/SECRET-VALUE/)).toBeNull();
    expect(onGranted).not.toHaveBeenCalled();
  });

  it('shows only the redacted load failure', async () => {
    const port = fakePort({ listCredentialCopySources: vi.fn().mockRejectedValue(new Error('token=SECRET-VALUE')) });
    mount({ port, onGranted: vi.fn(), sharedKeys: policy() });
    expect(await screen.findByRole('alert')).toHaveTextContent('Picker load failed; secret values omitted.');
    expect(screen.queryByText(/SECRET-VALUE/)).toBeNull();
  });

  // COPY-KEYS-NONDEFAULT-SOURCE: the injected source ID drives both the selection and the request.
  it('uses the injected non-default source ID for both selection and the outgoing request', async () => {
    const port = fakePort({ listCredentialCopySources: vi.fn().mockResolvedValue({ sources: [
      { siteId: 'pool-a', name: 'Pool A', keys: [{ kind: 'vendor', id: 'one', label: 'Main', provider: 'OpenAI' }] },
      { siteId: 'pool-b', name: 'Pool B', keys: [{ kind: 'vendor', id: 'bee', label: 'Bee', provider: 'OpenAI' }] },
    ] }) });
    mount({ port, onGranted: vi.fn(), sharedKeys: policy('pool-b') });
    fireEvent.click(await screen.findByRole('radio', { name: 'Bee · OpenAI' }));
    expect(screen.getAllByRole('radio').map(radio => radio.getAttribute('value'))).toEqual(['bee']);
    fireEvent.click(screen.getByRole('button', { name: 'Use this key on this site' }));
    expect(await screen.findByText('Granted to this site')).toBeVisible();
    expect(port.copyCredentials).toHaveBeenCalledWith({ sourceSiteId: 'pool-b', ids: ['bee'], overwrite: false });
  });
});
