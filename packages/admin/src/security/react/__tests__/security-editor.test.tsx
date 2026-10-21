import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KitProvider } from '@jini-ai/ui-kit/react';
import { createAdmin } from '../../../core/module/index.js';
import { security } from '../index.js';
import { createMemoryRootKey, createMemorySecurityApi } from '../../adapters/memory.js';
import type { CredentialProvider } from '../../models.js';

afterEach(cleanup);

const gitProvider: CredentialProvider = { kind: 'source-control', id: 'git', label: 'Git host', vendorLabel: 'Git vendor', category: 'source-control', tokenField: 'token', fields: [] };
const deployProvider: CredentialProvider = { kind: 'publish', id: 'deployer', label: 'Deployer', vendorLabel: 'Deploy vendor', category: 'hosting', tokenField: 'apiKey', tokenPageUrl: 'https://deploy.test/tokens',
  fields: [{ name: 'apiKey', label: 'Deploy API key', secret: true }, { name: 'team', label: 'Team slug', required: true }, { name: 'signing', label: 'Webhook signing value', secret: true }] };

function mount({ permissions, rootKeyScopeNotice, onTabChange }: { permissions: readonly string[]; rootKeyScopeNotice?: string; onTabChange?: (required: { tab: string }) => void }) {
  const feature = security({}, rootKeyScopeNotice ? { rootKeyScopeNotice } : {});
  const api = createMemorySecurityApi({ providers: [gitProvider, deployProvider] });
  const admin = createAdmin({ modules: [feature], ports: { securityApi: api, rootKey: createMemoryRootKey({}) } }, { permissions });
  const { Page, tabs } = feature.react.pages.secrets;
  render(
    <KitProvider>
      <feature.react.Provider admin={admin}>
        <Suspense fallback="Loading">
          <Page tabs={tabs} description={admin.describe().pages[0]!} {...(onTabChange ? { onTabChange } : {})} />
        </Suspense>
      </feature.react.Provider>
    </KitProvider>,
  );
  return { api };
}

describe('security credential editor', () => {
  it('collects the custom-provider fields and saves them under the chosen category', async () => {
    const { api } = mount({ permissions: ['security.read', 'custom-credentials.write'] });
    // Wait for the first load: the add action is inert until the tab's controller has mounted.
    await screen.findByLabelText('Search tokens');
    await waitFor(() => expect(screen.queryByText('Loading credentials…')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Add custom provider' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add credential' });
    const field = (label: string) => within(dialog).getByLabelText(label);
    fireEvent.change(field('Name'), { target: { value: 'Analytics' } });
    // No provider describes custom credentials, so the token keeps the generic label.
    fireEvent.change(field('Access token'), { target: { value: 'value-from-test' } });
    fireEvent.change(field('Category'), { target: { value: 'ai' } });
    fireEvent.change(field('Base URL'), { target: { value: 'https://analytics.test' } });
    fireEvent.change(field('Username'), { target: { value: 'robot' } });
    fireEvent.change(field('Additional hosts'), { target: { value: 'cdn.analytics.test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeVisible();
    const [saved] = await api.custom.list({}, {});
    expect(saved).toMatchObject({ label: 'Analytics', category: 'ai' });
    expect(JSON.stringify(saved)).not.toContain('value-from-test');
  });

  it('titles an existing credential as an edit and cancelling discards the draft', async () => {
    const { api } = mount({ permissions: ['security.read', 'custom-credentials.write'] });
    await api.custom.create({ label: 'Existing', connection: { token: 'abc' } }, {});
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Existing' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit credential' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await api.custom.list({}, {})).map(row => row.label)).toEqual(['Existing']);
  });
});

describe('security provider-described fields', () => {
  it('labels the token with the provider field and edits its extra fields', async () => {
    mount({ permissions: ['security.read', 'system.publish'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Deployer token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add credential' });
    expect(within(dialog).getByLabelText('Deploy API key')).toHaveAttribute('type', 'password');
    expect(within(dialog).queryByLabelText('Access token')).toBeNull();
    const team = within(dialog).getByLabelText(/Team slug/);
    expect(team).toHaveValue('');
    fireEvent.change(team, { target: { value: 'growth' } });
    expect(within(dialog).getByLabelText(/Team slug/)).toHaveValue('growth');
    expect(team).toHaveAttribute('type', 'text');
    // Secret extra fields are masked like the token itself.
    expect(within(dialog).getByLabelText('Webhook signing value')).toHaveAttribute('type', 'password');
    expect(within(dialog).queryByLabelText('Base URL')).toBeNull();
  });
});

describe('security page binding', () => {
  it('reports tab changes to the host and shows the host-supplied root-key scope notice', async () => {
    const onTabChange = vi.fn();
    mount({ permissions: ['security.read', 'admin.security.tokens.manage'], rootKeyScopeNotice: 'Keys are per workspace.', onTabChange });
    fireEvent.click(await screen.findByRole('tab', { name: 'Root key' }));
    expect(onTabChange).toHaveBeenCalledWith({ tab: 'root-key' });
    expect(await screen.findByText('Keys are per workspace.')).toBeVisible();
  });
});

describe('access tokens tab', () => {
  it('links to the provider token page and promotes a saved token to default', async () => {
    const { api } = mount({ permissions: ['security.read', 'system.publish'] });
    expect(await screen.findByRole('link', { name: 'Manage tokens at Deploy vendor' })).toHaveAttribute('href', 'https://deploy.test/tokens');
    const connection = { providerId: 'deployer', apiKey: 'k', team: 't', signing: 's' };
    await api.publish.create({ label: 'First', connection }, {});
    const second = await api.publish.create({ label: 'Second', connection }, {});
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await screen.findByRole('heading', { name: 'Second' });
    // Only the non-default saved token offers promotion.
    expect(screen.getAllByRole('button', { name: 'Make default' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Make default' }));
    await waitFor(async () => expect((await api.publish.list({}, {})).find(row => row.id === second.id)?.isDefault).toBe(true));
  });

  it('denies the tab itself to a viewer without the read grant', async () => {
    const feature = security({});
    const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({ providers: [gitProvider] }) } }, { permissions: ['security.read'] });
    const AccessTokens = feature.react.pages.secrets.tabs['access-tokens'];
    render(<KitProvider><feature.react.Provider admin={admin}><Suspense fallback="Loading"><AccessTokens params={{}} permissions={[]} /></Suspense></feature.react.Provider></KitProvider>);
    expect(await screen.findByText('Permission denied')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Access tokens' })).toBeNull();
  });
});
