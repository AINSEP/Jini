// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
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

  it('labels a key by provider, else by kind, lists what it works for, and shows a lock reason as a disabled choice', async () => {
    const port = fakePort({ listCredentialCopySources: vi.fn().mockResolvedValue({ sources: [{ siteId: 'pool-a', name: 'Pool A', keys: [
      { kind: 'vendor', id: 'one', label: 'Main', provider: 'OpenAI', worksFor: ['chat', 'images'] },
      { kind: 'custom', id: 'two', label: 'Bare', provider: null },
      { kind: 'vendor', id: 'three', label: 'Site key', provider: 'OpenAI', siteName: 'Blog', locked: 'Start that site first' },
    ] }] }) });
    mount({ port, onGranted: vi.fn(), sharedKeys: policy() });
    expect(await screen.findByRole('radio', { name: 'Main · OpenAI · chat, images' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Bare · custom' })).toBeEnabled();
    expect(screen.getByRole('radio', { name: 'Site key Start that site first' })).toBeDisabled();
  });

  it('notes how many more keys a site holds than it listed, only for site keys that report a count', async () => {
    const port = fakePort({ listCredentialCopySources: vi.fn().mockResolvedValue({ sources: [{ siteId: 'pool-a', name: 'Pool A', keys: [
      { kind: 'vendor', id: 'one', label: 'Main', provider: 'OpenAI', siteName: 'Blog', omittedCount: 3 },
      { kind: 'vendor', id: 'two', label: 'Other', provider: 'OpenAI', siteName: 'Shop' },
      { kind: 'vendor', id: 'four', label: 'Shared', provider: 'OpenAI', omittedCount: 9 },
    ] }] }) });
    mount({ port, onGranted: vi.fn(), sharedKeys: policy() });
    expect(await screen.findByText('Blog: 3 more not shown')).toBeInTheDocument();
    expect(screen.queryByText(/Shop:/)).toBeNull();
    expect(screen.queryByText(/9 more not shown/)).toBeNull();
  });

  it('says no keys are available when the configured source site is not in the answer', async () => {
    const port = fakePort({ listCredentialCopySources: vi.fn().mockResolvedValue({ sources: [{ siteId: 'elsewhere', name: 'Elsewhere', keys: [{ kind: 'vendor', id: 'x', label: 'X', provider: 'OpenAI' }] }] }) });
    mount({ port, onGranted: vi.fn(), sharedKeys: policy() });
    expect(await screen.findByText('No saved keys are available. Use Add credential to enter a new key.')).toBeInTheDocument();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByText(/more not shown/)).toBeNull();
  });

  it('reports a key the server did not grant with the redacted grant-failure line', async () => {
    const port = fakePort({ copyCredentials: vi.fn().mockResolvedValue({ results: [{ kind: 'vendor', id: 'one', status: 'failed' }] }) });
    mount({ port, onGranted: vi.fn(), sharedKeys: policy() });
    fireEvent.click(await screen.findByRole('radio', { name: 'Main · OpenAI' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this key on this site' }));
    expect(await screen.findByText('Grant failed; secret values omitted.')).toBeInTheDocument();
    expect(screen.queryByText('Granted to this site')).toBeNull();
  });

  it('closes on Cancel, but not while a grant is still in flight', async () => {
    let release!: (value: { results: [] }) => void;
    const port = fakePort({ copyCredentials: vi.fn(() => new Promise<{ results: [] }>((resolve) => { release = resolve; })) });
    const { result } = renderHook(() => useCopyKeys({ t, port, onGranted: vi.fn(), sharedKeys: policy() }));
    act(() => result.current.show({ currentTarget: document.createElement('button') }));
    await waitFor(() => expect(result.current.keys.map((key) => key.id)).toEqual(['one', 'two']));
    act(() => result.current.changeKey({ currentTarget: Object.assign(document.createElement('input'), { checked: true, value: 'one' }) } as never));
    let pending!: Promise<void>;
    act(() => { pending = result.current.submit({ preventDefault: () => {} }); });
    expect(result.current.pending).toBe(true);
    act(() => result.current.cancel());
    expect(result.current.open).toBe(true);

    await act(async () => { release({ results: [] }); await pending; });
    act(() => result.current.cancel());
    expect(result.current.open).toBe(false);
  });

  it('sends one grant for a double submit and none with no key chosen; unticking clears the choice', async () => {
    let release!: (value: { results: [] }) => void;
    const copyCredentials = vi.fn(() => new Promise<{ results: [] }>((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useCopyKeys({ t, port: fakePort({ copyCredentials }), onGranted: vi.fn(), sharedKeys: policy() }));
    act(() => result.current.show({ currentTarget: document.createElement('button') }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.submit({ preventDefault: () => {} }); });
    expect(copyCredentials).not.toHaveBeenCalled();

    const input = (checked: boolean) => ({ currentTarget: Object.assign(document.createElement('input'), { checked, value: 'two' }) }) as never;
    act(() => result.current.changeKey(input(true)));
    expect(result.current.keys.find((key) => key.id === 'two')?.checked).toBe(true);
    act(() => result.current.changeKey(input(false)));
    expect(result.current.keys.some((key) => key.checked)).toBe(false);
    expect(result.current.disabled).toBe(true);

    act(() => result.current.changeKey(input(true)));
    let first!: Promise<void>;
    act(() => { first = result.current.submit({ preventDefault: () => {} }); void result.current.submit({ preventDefault: () => {} }); });
    await act(async () => { release({ results: [] }); await first; });
    expect(copyCredentials).toHaveBeenCalledExactlyOnceWith({ sourceSiteId: 'pool-a', ids: ['two'], overwrite: false });
  });
});

