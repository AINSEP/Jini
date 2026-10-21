import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { createAdmin } from '../../../core/module/index.js';
import * as sourceControlCore from '../../index.js';
import { createHttpSourceControlApi } from '../../adapters/http.js';
import { createMemorySourceControlApi } from '../../adapters/memory.js';
import { sourceControlErrorMessage } from '../../rules.js';
import type { SourceControlApiPort, SourceControlTransportPort } from '../../ports.js';
import type { SourceControlProvider } from '../../models.js';
import { sourceControl, useSourceControlPorts } from '../index.js';
import { useSourceControlPage } from '../hooks/SourceControlPage.hooks.js';
import type { CredentialManagementPort } from '../../../contracts/credential-management.js';

afterEach(cleanup);

const guided: SourceControlProvider = { id: 'git', label: 'Git', credential: { tokenField: 'token', fields: [{ name: 'token', label: 'Access token', secret: true }], help: 'Use a fine-grained token.', tokenPageUrl: 'https://git.test/tokens' } };
const bare: SourceControlProvider = { id: 'svn', label: 'SVN', credential: { tokenField: 'token', fields: [{ name: 'token', label: 'Access token', secret: true }] } };

describe('source-control adapters', () => {
  it('copies credential guidance only when the server sent it', async () => {
    const transport: SourceControlTransportPort = { request: async <T,>() => ({ providers: [guided, bare] }) as T };
    const providers = await createHttpSourceControlApi({ transport, workspacePath: '/ws' }).providers({});
    expect(providers).toEqual([guided, bare]);
    expect(providers[1]!.credential).not.toHaveProperty('help');
    expect(providers[1]!.credential).not.toHaveProperty('tokenPageUrl');
    expect(Object.isFrozen(providers[0]!.credential!.fields[0])).toBe(true);
  });

  it('rejects a blank label and a connection moved to another provider', async () => {
    const api = createMemorySourceControlApi({ providers: [guided, bare] });
    await expect(api.create({ label: '   ', connection: { providerId: 'git', token: 't' } })).rejects.toMatchObject({ code: 'VALIDATION' });
    const saved = await api.create({ label: 'Work', connection: { providerId: 'git', token: 't' } });
    await expect(api.update({ id: saved.id, patch: { connection: { providerId: 'svn', token: 't' } } })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await api.list({})).map(row => row.providerId)).toEqual(['git']);
  });

  it('maps backend codes and messages to operator copy', () => {
    expect(sourceControlErrorMessage({ error: { code: 'DUPLICATE_LABEL' } })).toBe('This connection was already saved — reload and try again.');
    expect(sourceControlErrorMessage({ error: new Error('VALIDATION') })).toBe('Check the required credential fields.');
    expect(sourceControlErrorMessage({ error: null })).toBe('Unable to save connection');
  });

  it('exposes the module wired to its API token through the public barrel', () => {
    expect(sourceControlCore.sourceControlApiToken).toEqual({ id: 'admin.source-control.api', version: 1, cardinality: 'one' });
    expect(sourceControlCore.sourceControlModule.requires.sourceControlApi).toBe(sourceControlCore.sourceControlApiToken);
    expect(sourceControlCore.sourceControlModule.messages).toBe(sourceControlCore.sourceControlMessagesEn);
  });
});

function mount({ api, permissions, navigation, tabOnly }: { api: SourceControlApiPort; permissions: readonly string[]; navigation?: CredentialManagementPort; tabOnly?: { permissions: readonly string[] } }) {
  const feature = sourceControl({});
  const admin = createAdmin({ modules: [feature], ports: { sourceControlApi: api, ...(navigation ? { sourceControlNavigation: navigation } : {}) } }, { permissions });
  const { Page, tabs } = feature.react.pages.sourceControl;
  const Providers = tabs.providers;
  render(
    <feature.react.Provider admin={admin}>
      <Suspense fallback="Loading">
        {tabOnly ? <Providers params={{}} permissions={tabOnly.permissions} /> : <Page tabs={tabs} description={admin.describe().pages[0]!} />}
      </Suspense>
    </feature.react.Provider>,
  );
  return { admin, feature };
}

describe('source-control React', () => {
  it('shows token guidance and links to the provider token page', async () => {
    mount({ api: createMemorySourceControlApi({ providers: [guided] }), permissions: ['source-control.read', 'source-control.credentials.write'] });
    expect(await screen.findByText('Which token do I need?')).toBeInTheDocument();
    expect(screen.getByText(/Use a fine-grained token\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a token' })).toHaveAttribute('href', 'https://git.test/tokens');
  });

  it('surfaces a failed token save', async () => {
    const api = createMemorySourceControlApi({ providers: [guided] });
    api.create = () => Promise.reject(Object.assign(new Error('DUPLICATE_LABEL'), { code: 'DUPLICATE_LABEL' }));
    mount({ api, permissions: ['source-control.read', 'source-control.credentials.write'] });
    fireEvent.change(await screen.findByLabelText('Git Access token'), { target: { value: 'value-typed-in-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Git token' }));
    expect(await screen.findByText('This connection was already saved — reload and try again.')).toBeInTheDocument();
  });

  it('flags a saved token whose provider is no longer listed', async () => {
    const api = createMemorySourceControlApi({ providers: [], credentials: [{ id: 'c1', providerId: 'gone', label: 'Old', configured: true, isDefault: true, createdAt: 'then', updatedAt: 'then' }] });
    mount({ api, permissions: ['source-control.read'] });
    expect(await screen.findByText('Its plugin is off or missing. Manage this token on the Access tokens page.')).toBeInTheDocument();
  });

  it('opens the host credential manager when navigation is supplied', async () => {
    const navigation = { open: vi.fn() };
    mount({ api: createMemorySourceControlApi({ providers: [guided] }), permissions: ['source-control.read'], navigation });
    fireEvent.click(await screen.findByRole('button', { name: 'Create access token' }));
    expect(navigation.open).toHaveBeenCalledWith({ kind: 'source-control' });
  });

  it('denies the providers tab to a viewer without the read grant', async () => {
    mount({ api: createMemorySourceControlApi({ providers: [guided] }), permissions: ['source-control.read'], tabOnly: { permissions: [] } });
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload connections' })).toBeNull();
  });

  it('defaults to the providers tab and reports tab changes to the host', () => {
    const feature = sourceControl({});
    const admin = createAdmin({ modules: [feature], ports: { sourceControlApi: createMemorySourceControlApi({}) } }, { permissions: ['source-control.read'] });
    const { tabs } = feature.react.pages.sourceControl;
    const onTabChange = vi.fn();
    const { result } = renderHook(() => useSourceControlPage({ tabs, description: admin.describe().pages[0]!, onTabChange }));
    expect(result.current.ActiveTab).toBe(tabs.providers);
    result.current.onValueChange({ value: 'providers' });
    expect(onTabChange).toHaveBeenCalledWith({ tab: 'providers' });
  });

  it('refuses to resolve ports outside a source-control scope', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useSourceControlPorts())).toThrow('React scope unavailable: source-control');
    error.mockRestore();
  });
});
