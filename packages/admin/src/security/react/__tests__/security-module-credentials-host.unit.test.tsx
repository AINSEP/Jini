import { TestChipField } from './chip-field.fixture.js';
import { testClipboard } from './clipboard.fixture.js';
import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { AdminKitProvider } from '../../../react/kit.js';
import { reactModuleUi } from '../../../core/react/module-ui.js';
import { createAdmin } from '../../../core/module/index.js';
import { createMemorySecurityApi, createMemoryRootKey } from '../../adapters/memory.js';
import { security, useSecurityCredentialsHost, type SecurityCredentialsHost } from '../index.js';
import type { SecurityRefreshSignal } from '../../ports.js';

// SEC-13/SEC-14: the module hands the host's credential options to both credential controllers
// through one host context. Only the options the host gave appear there.
afterEach(cleanup);
type Options = Parameters<typeof security>[1];

async function hostSeenByTab(options: Options): Promise<SecurityCredentialsHost> {
  const feature = security({ ui: reactModuleUi, ChipField: TestChipField, clipboard: testClipboard }, options);
  const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}), rootKey: createMemoryRootKey({}) } }, { permissions: ['security.read'] });
  const { Page, tabs } = feature.react.pages.secrets;
  const seen: SecurityCredentialsHost[] = [];
  function HostProbe() { seen.push(useSecurityCredentialsHost({})); return <p>probe</p>; }
  render(<AdminKitProvider kit={testAdminKit}><feature.react.Provider admin={admin}><Suspense fallback="Loading">
    <Page tabs={{ ...tabs, ...({ 'access-tokens': HostProbe } as Record<string, unknown>) } as typeof tabs} description={admin.describe().pages[0]!} />
  </Suspense></feature.react.Provider></AdminKitProvider>);
  await screen.findByText('probe');
  return seen.at(-1)!;
}

describe('security module credential host options', () => {
  it('passes every credential option the host gave, unchanged, to the tabs', async () => {
    const refreshSignal: SecurityRefreshSignal = { subscribe: () => () => undefined };
    const onCredentialsChanged = vi.fn();
    const describeCredentialError = vi.fn(() => undefined);
    const credentialDraftError = vi.fn(() => null);
    const otherStores = { 'media-provider': { href: '/host/media', label: 'Media' } };
    const host = await hostSeenByTab({ otherStores, refreshSignal, onCredentialsChanged, describeCredentialError, credentialDraftError });
    expect(Object.keys(host).sort()).toEqual(['describeError', 'draftError', 'onCredentialsChanged', 'otherStores', 'refreshSignal']);
    expect(host.otherStores).toBe(otherStores);
    expect(host.refreshSignal).toBe(refreshSignal);
    expect(host.onCredentialsChanged).toBe(onCredentialsChanged);
    expect(host.describeError).toBe(describeCredentialError);
    expect(host.draftError).toBe(credentialDraftError);
  });

  it('gives the tabs an empty host when no credential option is set', async () => {
    const host = await hostSeenByTab({ rootKeyScopeNotice: 'Scoped' });
    expect(host).toEqual({});
  });
});
