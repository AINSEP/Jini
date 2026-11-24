import { reactModuleUi } from '../../../core/react/module-ui.js';
import { testClipboard } from './clipboard.fixture.js';
import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '../../../__tests__/fetch-query-support.js';
import { KitProvider } from '@jini-ai/ui-kit/react';
import { createAdmin } from '../../../core/module/index.js';
import { security } from '../index.js';
import { createMemorySecurityApi } from '../../adapters/memory.js';
import type { CredentialProvider, CredentialSummary } from '../../models.js';
import { TestChipField } from './chip-field.fixture.js';

afterEach(cleanup);
const TOKEN = 'fixture-token';
const deploy: CredentialProvider = { kind: 'publish', id: 'deployer', label: 'Deployer', vendorLabel: 'Deploy vendor', category: 'hosting', tokenField: 'secretKey', tokenPageUrl: 'https://deploy.test/tokens', help: 'Grant the deploy scope only.',
  fields: [{ name: 'accessKeyId', label: 'Access key ID', required: true, help: 'Shown once in the console.' }, { name: 'secretKey', label: 'Secret key', secret: true }, { name: 'signing', label: 'Signing value', secret: true }] };
const git: CredentialProvider = { kind: 'source-control', id: 'git', label: 'Git host', vendorLabel: 'Git vendor', category: 'source-control', tokenField: 'token', fields: [] };
const saved = (over: Partial<CredentialSummary>): CredentialSummary => ({ kind: 'publish', id: 'p1', providerId: 'deployer', label: 'First', configured: true, isDefault: true, createdAt: 'd', updatedAt: 'd', ...over });
const WRITE = ['security.read', 'system.publish', 'source-control.credentials.write', 'custom-credentials.write'];

async function mount({ rows = [], permissions = WRITE }: { rows?: CredentialSummary[]; permissions?: readonly string[] }) {
  const feature = security({ ui: reactModuleUi, ChipField: TestChipField, clipboard: testClipboard });
  const api = createMemorySecurityApi({ providers: [deploy, git], rows });
  const admin = createAdmin({ modules: [feature], ports: { securityApi: api } }, { permissions });
  const AccessTokens = feature.react.pages.secrets.tabs['access-tokens'];
  const view = render(<KitProvider><feature.react.Provider admin={admin}><Suspense fallback="Loading"><AccessTokens params={{}} permissions={permissions} /></Suspense></feature.react.Provider></KitProvider>);
  await screen.findByLabelText('Search tokens'); await waitFor(() => expect(screen.queryByText('Loading credentials…')).toBeNull());
  return { api, view };
}
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('SEC-10 vendor token form', () => {
  it('renders the fields declared before the token above it, help below each field, and the scope guidance', async () => {
    await mount({});
    fireEvent.click(screen.getByRole('button', { name: 'Add Deployer token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add credential' });
    const access = within(dialog).getByLabelText(/Access key ID/), secret = within(dialog).getByLabelText('Secret key'), signing = within(dialog).getByLabelText('Signing value');
    expect(before(access, secret)).toBe(true); expect(before(secret, signing)).toBe(true);
    expect(within(dialog).getByText('Shown once in the console.')).toBeInTheDocument();
    expect(within(dialog).getByText('Which permissions to grant')).toBeInTheDocument();
    expect(within(dialog).getByText('Grant the deploy scope only.')).toBeInTheDocument();
    // Every secret input, the extra ones included, is private to agents (a masked kit input carries the marker itself).
    const isPrivate = (input: Element) => input.hasAttribute('data-agent-private');
    expect(isPrivate(signing)).toBe(true); expect(isPrivate(secret)).toBe(true); expect(isPrivate(access)).toBe(false);
  });

  it('keeps a disabled-plugin worksFor id as a chip and saves a worksFor-only edit without a connection', async () => {
    const { api } = await mount({ rows: [saved({ worksFor: ['gone-plugin'] })] }); const update = vi.spyOn(api.publish, 'update');
    fireEvent.click(screen.getByRole('button', { name: 'Edit First' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit credential' });
    const chips = within(dialog).getByRole('group', { name: 'Works for' });
    expect(within(chips).getByLabelText('gone-plugin')).toBeChecked(); expect(within(chips).getByLabelText('Deployer')).not.toBeChecked();
    // Nothing changed yet: there is no diff to send.
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(within(chips).getByLabelText('gone-plugin'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 'p1', patch: { worksFor: [] } }, expect.anything()));
  });

  it('offers no works-for chips on a source-control credential', async () => {
    await mount({});
    fireEvent.click(screen.getByRole('button', { name: 'Add Git host token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add credential' });
    expect(within(dialog).queryByRole('group', { name: 'Works for' })).toBeNull();
  });

  it('shows the default indicator only once a provider has two saved tokens', async () => {
    await mount({ rows: [saved({})] });
    expect(screen.queryByText('Default')).toBeNull(); expect(screen.queryByRole('button', { name: /Make default/ })).toBeNull();
    cleanup();
    await mount({ rows: [saved({}), saved({ id: 'p2', label: 'Second', isDefault: false })] });
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make default — Second' })).toBeInTheDocument();
  });

  it('states the removal consequence, links revocation to the vendor and notes the last saved token', async () => {
    await mount({ rows: [saved({}), saved({ id: 'p2', label: 'Second', isDefault: false })] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Second' }));
    let dialog = await screen.findByRole('alertdialog', { name: 'Remove credential' });
    expect(within(dialog).getByText(/does NOT revoke the token on Deploy vendor/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Revoke it on Deploy vendor/ })).toHaveAttribute('href', 'https://deploy.test/tokens');
    expect(within(dialog).queryByText(/only saved Deployer token/)).toBeNull();
    cleanup();
    await mount({ rows: [saved({})] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove First' }));
    dialog = await screen.findByRole('alertdialog', { name: 'Remove credential' });
    expect(within(dialog).getByText(/only saved Deployer token/)).toBeInTheDocument();
  });

  it.each([['system.publish', 'Deployer', 'First'], ['source-control.credentials.write', 'Git host', 'Mine']])('without %s there is no add, edit or remove for %s', async (_grant, provider, label) => {
    const rows = [saved({}), saved({ kind: 'source-control', id: 's1', providerId: 'git', label: 'Mine' })];
    await mount({ rows, permissions: WRITE.filter(p => p !== _grant) });
    expect(screen.queryByRole('button', { name: `Add another ${provider} token` })).toBeNull();
    expect(screen.queryByRole('button', { name: `Edit ${label}` })).toBeNull(); expect(screen.queryByRole('button', { name: `Remove ${label}` })).toBeNull();
  });

  it('never leaves a typed secret in the page or the console after saving', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { view } = await mount({});
    fireEvent.click(screen.getByRole('button', { name: 'Add Deployer token' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add credential' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Prod' } });
    fireEvent.change(within(dialog).getByLabelText(/Access key ID/), { target: { value: 'AK' } });
    fireEvent.change(within(dialog).getByLabelText('Secret key'), { target: { value: TOKEN } });
    fireEvent.change(within(dialog).getByLabelText('Signing value'), { target: { value: `${TOKEN}-signing` } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Prod' });
    expect(view.container.innerHTML).not.toContain(TOKEN); expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
    log.mockRestore();
  });
});
