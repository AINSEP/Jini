import { TestChipField } from './chip-field.fixture.js';
import { Suspense, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { render, screen, fireEvent, cleanup, waitFor, within, testAdminKit } from '../../../__tests__/fetch-query-support.js';
import { AdminKitProvider, type TabBarProps } from '../../../react/kit.js';
import { reactModuleUi } from '../../../core/react/module-ui.js';
import { createAdmin } from '../../../core/module/index.js';
import { createMemorySecurityApi, createMemoryRootKey } from '../../adapters/memory.js';
import { englishSecurity } from '../../messages.en.js';
import { security, type SecurityTranslator } from '../index.js';

// SEC-1 (P9-SEC plan v2): the module takes media's `({ ui }, options)` shape, renders the kit
// `TabBar` with the stable agent handles, takes host icons and a live host translator, and merges
// the root-key tab options into that tab's params. Ports the tab-visibility and deep-link cases of
// the host's `Security.unit.test.tsx` and the grant table of `use-security-permissions.unit.test.tsx`.
afterEach(cleanup);
const bars: TabBarProps[] = [];
function RecordingTabBar(p: TabBarProps) {
  bars.push(p);
  return <div role="tablist" aria-label={p.ariaLabel} data-container-handle={p.containerHandle}>{p.tabs.map(t => <button key={t.id} type="button" role="tab" aria-selected={t.id === p.activeId} data-handle={t.handle} data-handle-label={t.handleLabel} onClick={() => p.onChange(t.id)}>{t.icon}{t.label}</button>)}</div>;
}
const kit = { ...testAdminKit, components: { ...testAdminKit.components, TabBar: RecordingTabBar } };
type Options = Parameters<typeof security>[1];
interface MountOptions { options?: Options; requestedTab?: string; onTabChange?: (r: { tab: string }) => void; t?: SecurityTranslator; tabs?: Record<string, unknown> }
function mount(permissions: readonly string[], m: MountOptions = {}) {
  bars.length = 0;
  const feature = security({ ui: reactModuleUi, ChipField: TestChipField }, m.options ?? {}), api = createMemorySecurityApi({});
  const providers = vi.spyOn(api, 'providers');
  const admin = createAdmin({ modules: [feature], ports: { securityApi: api, rootKey: createMemoryRootKey({}) } }, { permissions });
  const { Page, tabs } = feature.react.pages.secrets;
  const description = admin.describe().pages[0]!;
  const tree = (t?: SecurityTranslator): ReactNode => <AdminKitProvider kit={kit}><feature.react.Provider admin={admin} {...(t ? { t } : {})}><Suspense fallback="Loading"><Page tabs={{ ...tabs, ...m.tabs } as typeof tabs} description={description} {...(m.requestedTab ? { requestedTab: m.requestedTab } : {})} {...(m.onTabChange ? { onTabChange: m.onTabChange } : {})} /></Suspense></feature.react.Provider></AdminKitProvider>;
  const view = render(tree(m.t));
  return { admin, api, providers, description, rerender: (t?: SecurityTranslator) => view.rerender(tree(t)) };
}
const tabIds = () => bars.at(-1)!.tabs.map(t => t.id);

describe('SEC-1 security module shape', () => {
  it.each([
    [['security.read'], ['access-tokens']],
    [['security.read', 'admin.security.tokens.manage'], ['access-tokens', 'root-key']],
  ] as const)('grants %j offer tabs %j', async (permissions, expected) => {
    mount(permissions);
    await screen.findByRole('tablist');
    expect(tabIds()).toEqual(expected);
  });

  it('a read-only operator who follows a root-key deep link lands on Access tokens, never the root-key panel', async () => {
    const RootProbe = vi.fn(() => <p>root panel</p>);
    mount(['security.read'], { requestedTab: 'root-key', tabs: { 'root-key': RootProbe } });
    await screen.findByRole('tablist');
    expect(tabIds()).toEqual(['access-tokens']);
    expect(bars.at(-1)!.activeId).toBe('access-tokens');
    expect(screen.queryByText('root panel')).toBeNull();
    expect(RootProbe).not.toHaveBeenCalled();
  });

  it('an unrecognised requested tab falls back to Access tokens even with the root-key grant', async () => {
    mount(['security.read', 'admin.security.tokens.manage'], { requestedTab: 'not-a-real-tab' });
    await screen.findByRole('tablist');
    expect(bars.at(-1)!.activeId).toBe('access-tokens');
  });

  it('a denied page shows the denied notice and renders no TabBar', async () => {
    mount([]);
    expect(await screen.findByText('Permission denied')).toBeVisible();
    expect(bars).toHaveLength(0);
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('each tab carries its handle, handle label and host icon, and the bar its container handle', async () => {
    mount(['security.read', 'admin.security.tokens.manage'], { options: { tabIcons: { 'access-tokens': <svg data-testid="icon-tokens" />, 'root-key': <svg data-testid="icon-root" /> } } });
    const bar = await screen.findByRole('tablist');
    expect(bar).toHaveAttribute('data-container-handle', 'security-tab-bar');
    expect(bar).toHaveAttribute('aria-label', englishSecurity('tabsLabel'));
    const tokens = within(bar).getByRole('tab', { name: 'Access tokens' }), root = within(bar).getByRole('tab', { name: 'Root key' });
    expect(tokens).toHaveAttribute('data-handle', 'security-tab-access-tokens');
    expect(tokens).toHaveAttribute('data-handle-label', englishSecurity('accessTokensHandleLabel'));
    expect(root).toHaveAttribute('data-handle', 'security-tab-site-key');
    expect(root).toHaveAttribute('data-handle-label', englishSecurity('rootKeyHandleLabel'));
    expect(within(tokens).getByTestId('icon-tokens')).toBeTruthy();
    expect(within(root).getByTestId('icon-root')).toBeTruthy();
  });

  it('renders the kicker, heading and description from the translator', async () => {
    mount(['security.read']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Secrets' })).toBeVisible();
    expect(screen.getByText(englishSecurity('kicker'))).toBeVisible();
    expect(screen.getByText(englishSecurity('description'))).toBeVisible();
  });

  it('merges the root-key tab options into that tab\'s params and they reach the RootKeyTab view', async () => {
    const seen: TabViewProps[] = [];
    const RootProbe = (props: TabViewProps) => { seen.push(props); return <p>root panel</p>; };
    const { description } = mount(['security.read', 'admin.security.tokens.manage'], { requestedTab: 'root-key', tabs: { 'root-key': RootProbe }, options: { rootKeyScopeNotice: 'Scope copy', rootKeyTab: { generate: 'hidden', defaultEnvVarName: 'X', previewRequired: false } } });
    expect(await screen.findByText('root panel')).toBeVisible();
    const expected = { scopeNotice: 'Scope copy', generate: 'hidden', defaultEnvVarName: 'X', previewRequired: false };
    expect(description.tabs.find(t => t.id.endsWith('.root-key'))!.params).toEqual(expected);
    expect(seen.at(-1)!.params).toEqual(expected);
  });

  it('keeps stock root-key params empty when no option is given', () => {
    const { description } = mount(['security.read', 'admin.security.tokens.manage']);
    expect(description.tabs.find(t => t.id.endsWith('.root-key'))!.params).toEqual({});
  });

  it('swapping the host translator relabels in place without disposing the tab controller', async () => {
    const { providers, rerender } = mount(['security.read', 'admin.security.tokens.manage']);
    await screen.findByRole('tablist');
    await waitFor(() => expect(providers).toHaveBeenCalled());
    const loads = providers.mock.calls.length;
    rerender((key) => `HOST ${key}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'HOST security' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'HOST accessTokens' })).toHaveAttribute('data-handle-label', 'HOST accessTokensHandleLabel');
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'HOST tabsLabel');
    expect(providers.mock.calls.length).toBe(loads);
  });

  it('fires onTabChange once per change', async () => {
    const onTabChange = vi.fn();
    mount(['security.read', 'admin.security.tokens.manage'], { onTabChange });
    fireEvent.click(await screen.findByRole('tab', { name: 'Root key' }));
    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange).toHaveBeenCalledWith({ tab: 'root-key' });
    fireEvent.click(screen.getByRole('tab', { name: 'Access tokens' }));
    expect(onTabChange).toHaveBeenCalledTimes(2);
    expect(onTabChange).toHaveBeenLastCalledWith({ tab: 'access-tokens' });
  });
});
