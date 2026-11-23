import { Suspense } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '../../../__tests__/fetch-query-support.js';
import { reactModuleUi } from '../../../core/react/module-ui.js';
import { createAdmin } from '../../../core/module/index.js';
import { createMemorySecurityApi, createMemoryRootKey } from '../../adapters/memory.js';
import type { RootKeyStatus } from '../../models.js';
import { security, type SecurityModuleOptions } from '../index.js';

// SEC-5 (P9-SEC plan v2), through the real module, hook and controller: status badge, fingerprint
// with its hint, source notes, runtime-dependent scope note, generate visibility from the root-key
// tab options, and typed refusals that show only the described detail. Ports the status, badge and
// note cases of the host's `SiteKeyTab.unit.test.tsx`.
afterEach(cleanup);
const FIXTURE_KEY = 'a3f9'.repeat(16);
const st = (over: Partial<RootKeyStatus>): RootKeyStatus => ({ active: true, source: 'file', state: 'active', keyFilePath: '/srv/root.key', runtimeMode: 'local', fingerprint: 'fp-1234', ...over });
function mount(status: RootKeyStatus, options: SecurityModuleOptions = {}, rootKey = createMemoryRootKey({ status })) {
  const feature = security({ ui: reactModuleUi }, options);
  const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}), rootKey } }, { permissions: ['security.read', 'admin.security.tokens.manage'] });
  const { Page, tabs } = feature.react.pages.secrets;
  return render(<feature.react.Provider admin={admin}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} requestedTab="root-key" /></Suspense></feature.react.Provider>);
}

describe('SEC-5 root key status presentation', () => {
  it('badges an env key with the server env var name and explains the source', async () => {
    mount(st({ source: 'env', envVarName: 'KEY_VAR' }));
    expect(await screen.findByText('Active: environment variable KEY_VAR')).toBeVisible();
    expect(screen.getByText(/set directly on the server/)).toBeVisible();
  });
  it('falls back to the host default env var name', async () => {
    mount(st({ source: 'env' }), { rootKeyTab: { defaultEnvVarName: 'HOST_VAR' } });
    expect(await screen.findByText('Active: environment variable HOST_VAR')).toBeVisible();
  });
  it('shows the fingerprint with its hint, and the key file path as code', async () => {
    mount(st({}));
    expect(await screen.findByText('Active: key file')).toBeVisible();
    const fp = screen.getByText('fp-1234');
    expect(fp.tagName).toBe('CODE');
    expect(fp.closest('[title]')).toHaveAttribute('title', 'A short ID for this key. It changes if the key changes.');
    expect(screen.getByText('/srv/root.key').tagName).toBe('CODE');
  });
  it('explains an invalid file key and names the path to fix', async () => {
    mount(st({ active: false, invalid: true, state: 'invalid' as RootKeyStatus['state'] }));
    expect(await screen.findByText(/is not in a usable format/)).toBeVisible();
    expect(screen.getByText('/srv/root.key').tagName).toBe('CODE');
  });
  it('adds the production storage note only in production', async () => {
    mount(st({ runtimeMode: 'production' }));
    expect(await screen.findByText(/stored next to the database/)).toBeVisible();
    cleanup();
    mount(st({}));
    await screen.findByText('Active: key file');
    expect(screen.queryByText(/stored next to the database/)).toBeNull();
  });
});

describe('SEC-5 generate visibility and refusals', () => {
  const missing = st({ active: false, source: 'none', state: 'missing', fingerprint: undefined as unknown as string });
  it('offers create by default for a missing key', async () => {
    mount(missing);
    expect(await screen.findByRole('button', { name: 'Create root key' })).toBeVisible();
  });
  it('hides create when the host sets generate: hidden', async () => {
    mount(missing, { rootKeyTab: { generate: 'hidden' } });
    expect(await screen.findByText('A key is created automatically when this install starts.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create root key' })).toBeNull();
  });
  it('shows a KEY_INVALID refusal by its described detail and never the raw message', async () => {
    const rootKey = createMemoryRootKey({ status: missing });
    rootKey.generate = () => Promise.reject(Object.assign(new Error(FIXTURE_KEY), { code: 'KEY_INVALID', detail: 'The configured key is not valid.' }));
    const describeError = ({ error }: { error: unknown }) => { const e = error as { code: string; detail: string }; return { code: e.code, detail: e.detail }; };
    const { container } = mount(missing, { describeError }, rootKey);
    fireEvent.click(await screen.findByRole('button', { name: 'Create root key' }));
    expect(await screen.findByText('The configured key is not valid.')).toBeVisible();
    await waitFor(() => expect(container.textContent).not.toContain(FIXTURE_KEY));
  });
});
