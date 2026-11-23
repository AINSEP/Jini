import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, testAdminKit } from '../../../__tests__/fetch-query-support.js';
import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { AdminKitProvider, type TabBarProps } from '../../../react/kit.js';
import { reactModuleUi } from '../../../core/react/module-ui.js';
import { createAdmin } from '../../../core/module/index.js';
import { security, type SecurityTranslator, type SecurityOptions } from '../index.js';
import { createMemorySecurityApi, createMemoryRootKey } from '../../adapters/memory.js';

afterEach(cleanup);
const ROOT = 'admin.security.tokens.manage';
const makeFeature = (options: SecurityOptions = {}) => security({ ui: reactModuleUi }, options);
type Feature = ReturnType<typeof makeFeature>;
/** Records every TabBar the page renders, so the test sees the exact props the host kit receives. */
function recordingKit() {
  const seen: TabBarProps[] = [];
  const kit = { ...testAdminKit, components: { ...testAdminKit.components, TabBar(props: TabBarProps) { seen.push(props); const Fake = testAdminKit.components.TabBar; return <Fake {...props} />; } } };
  return { kit, seen, last: () => seen.at(-1) };
}
function mount({ permissions, feature = makeFeature(), requestedTab, onTabChange, t }: { permissions: readonly string[]; feature?: Feature; requestedTab?: string; onTabChange?: (args: { tab: string }) => void; t?: SecurityTranslator }) {
  const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}), rootKey: createMemoryRootKey({}) } }, { permissions });
  const { Page, tabs } = feature.react.pages.secrets; const recorder = recordingKit();
  const tree = (translator?: SecurityTranslator): ReactNode => <AdminKitProvider kit={recorder.kit}><feature.react.Provider admin={admin} {...(translator ? { t: translator } : {})}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} {...(requestedTab ? { requestedTab } : {})} {...(onTabChange ? { onTabChange } : {})} /></Suspense></feature.react.Provider></AdminKitProvider>;
  const view = render(tree(t));
  return { ...recorder, rerender: (translator: SecurityTranslator) => view.rerender(tree(translator)) };
}

describe('security() module shape (SEC-1)', () => {
  it('offers only access-tokens for a security.read-only operator, and a root-key deep link falls back', async () => {
    const { last } = mount({ permissions: ['security.read'], requestedTab: 'root-key' });
    await screen.findByRole('tablist');
    expect(last()!.tabs.map(tab => tab.id)).toEqual(['access-tokens']);
    expect(last()!.activeId).toBe('access-tokens');
  });
  it('offers root-key with admin.security.tokens.manage', async () => {
    const { last } = mount({ permissions: ['security.read', ROOT] });
    await screen.findByRole('tablist');
    expect(last()!.tabs.map(tab => tab.id)).toEqual(['access-tokens', 'root-key']);
  });
  it('renders the denied notice and no TabBar without security.read', async () => {
    const { seen } = mount({ permissions: [] });
    expect(await screen.findByText('Permission denied')).toBeVisible();
    expect(screen.queryByRole('tablist')).toBeNull(); expect(seen).toHaveLength(0);
  });
  it('renders the kicker, heading and description', async () => {
    mount({ permissions: ['security.read'] });
    expect(await screen.findByText('Operations')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Secrets' })).toBeVisible();
    expect(screen.getByText(/One place to see every access token this install holds/)).toBeVisible();
  });
  it('gives each tab its handle, handle label and host icon, and the bar its container handle', async () => {
    const feature = makeFeature({ tabIcons: { 'access-tokens': <i data-testid="icon-tokens" />, 'root-key': <i data-testid="icon-root" /> } });
    const { last } = mount({ permissions: ['security.read', ROOT], feature });
    await screen.findByRole('tablist');
    const [tokens, root] = last()!.tabs;
    expect(last()!.containerHandle).toBe('security-tab-bar');
    expect(tokens).toMatchObject({ handle: 'security-tab-access-tokens', handleLabel: 'Switch to the Access Tokens tab — every access token and other saved credential this install holds, in one place' });
    expect(root).toMatchObject({ handle: 'security-tab-site-key', handleLabel: 'Switch to the root key tab' });
    render(<>{tokens!.icon}{root!.icon}</>);
    expect(screen.getByTestId('icon-tokens')).toBeDefined(); expect(screen.getByTestId('icon-root')).toBeDefined();
  });
  it('hands rootKeyTab options to the root-key tab params', async () => {
    const feature = makeFeature({ rootKeyScopeNotice: 'scope', rootKeyTab: { generate: 'hidden', defaultEnvVarName: 'X' } });
    const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}), rootKey: createMemoryRootKey({}) } }, { permissions: ['security.read', ROOT] });
    const rootTab = admin.describe().pages[0]!.tabs.find(tab => tab.id.endsWith('.root-key'))!;
    expect(rootTab.params).toEqual({ scopeNotice: 'scope', generate: 'hidden', defaultEnvVarName: 'X' });
  });
  it('relabels on a translator swap without disposing the active tab', async () => {
    let mounts = 0;
    function Probe(_props: TabViewProps) { useEffect(() => { mounts += 1; }, []); return <p>probe</p>; }
    const feature = makeFeature();
    const tabs = { ...feature.react.pages.secrets.tabs, 'access-tokens': Probe } as typeof feature.react.pages.secrets.tabs;
    const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}) } }, { permissions: ['security.read'] });
    const { Page } = feature.react.pages.secrets; const { kit, last } = recordingKit();
    function Host() { const [upper, setUpper] = useState(false); const t: SecurityTranslator = key => upper ? key.toUpperCase() : key;
      return <AdminKitProvider kit={kit}><button onClick={() => setUpper(true)}>swap</button><feature.react.Provider admin={admin} t={t}><Page tabs={tabs} description={admin.describe().pages[0]!} /></feature.react.Provider></AdminKitProvider>; }
    render(<Host />);
    await screen.findByText('probe');
    expect(last()!.tabs[0]!.label).toBe('Access tokens');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'swap' })); });
    await waitFor(() => expect(last()!.tabs[0]!.label).toBe('ACCESS TOKENS'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('SECRETS');
    expect(mounts).toBe(1);
  });
  it('fires onTabChange once per change', async () => {
    const onTabChange = vi.fn();
    mount({ permissions: ['security.read', ROOT], onTabChange });
    fireEvent.click(await screen.findByRole('tab', { name: 'Root key' }));
    expect(onTabChange).toHaveBeenCalledTimes(1); expect(onTabChange).toHaveBeenCalledWith({ tab: 'root-key' });
  });
});

describe('root-key tab presentation through the module (SEC-5)', () => {
  it('offers Create when generate is shown and there is no key', async () => {
    mount({ permissions: ['security.read', ROOT], requestedTab: 'root-key' });
    expect(await screen.findByRole('button', { name: 'Create root key' })).toBeTruthy();
    expect(screen.getByText('None')).toBeTruthy();
    expect(screen.getByText('No key yet. Create one to protect saved credentials.')).toBeTruthy();
  });
  it('hides Create when the host hides generate', async () => {
    mount({ permissions: ['security.read', ROOT], requestedTab: 'root-key', feature: makeFeature({ rootKeyTab: { generate: 'hidden' } }) });
    expect(await screen.findByText('A key is created automatically when this site starts.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create root key' })).toBeNull();
  });
  it('translates the badge and shows host-approved copy for a known refusal code, never the reader detail', async () => {
    const secret = 'a3f9'.repeat(16);
    const feature = makeFeature({ describeRootKeyError: () => ({ code: 'KEY_INVALID', detail: `The stamp ${secret} is unreadable.` }), describeRootKeyRefusal: ({ code }) => code === 'KEY_INVALID' ? 'Approved: the site stamp is unreadable.' : undefined });
    const root = createMemoryRootKey({}); root.generate = () => Promise.reject(new Error('raw'));
    const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}), rootKey: root } }, { permissions: ['security.read', ROOT] });
    const { Page, tabs } = feature.react.pages.secrets;
    render(<AdminKitProvider kit={testAdminKit}><feature.react.Provider admin={admin} t={key => key === 'None' ? 'Ninguna' : key}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} requestedTab="root-key" /></Suspense></feature.react.Provider></AdminKitProvider>);
    expect(await screen.findByText('Ninguna')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create root key' }));
    expect(await screen.findByText('Approved: the site stamp is unreadable.')).toBeTruthy();
    expect(document.body.textContent).not.toContain('raw'); expect(document.body.textContent).not.toContain(secret);
  });
  it('uses fixed fallback copy for an unknown refusal code, with the echoed secret absent from the DOM', async () => {
    const secret = 'b4e0'.repeat(16);
    const feature = makeFeature({ describeRootKeyError: () => ({ code: 'SOMETHING_NEW', detail: `key ${secret}` }) });
    const root = createMemoryRootKey({}); root.generate = () => Promise.reject(new Error('raw'));
    const admin = createAdmin({ modules: [feature], ports: { securityApi: createMemorySecurityApi({}), rootKey: root } }, { permissions: ['security.read', ROOT] });
    const { Page, tabs } = feature.react.pages.secrets;
    render(<AdminKitProvider kit={testAdminKit}><feature.react.Provider admin={admin} t={key => key}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} requestedTab="root-key" /></Suspense></feature.react.Provider></AdminKitProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Create root key' }));
    expect(await screen.findByText('The root key could not be created.')).toBeTruthy();
    expect(document.body.textContent).not.toContain(secret);
  });

});
