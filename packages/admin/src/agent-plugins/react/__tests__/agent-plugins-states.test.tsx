import { StrictMode, Suspense } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { AdminConfigError, createAdmin } from '../../../core/module/index.js';
import { agentPlugins } from '../index.js';
import { createMemoryAgentPluginsApi } from '../../adapters/memory.js';
import { AgentPluginListPanel } from '../components/AgentPluginListPanel.js';
import { AgentPluginInspector } from '../components/AgentPluginInspector.js';
import { MarketplaceTab } from '../tabs/MarketplaceTab.js';
import { AgentPluginsPageContext } from '../hooks/AgentPluginsPage.hooks.js';
import { AgentPluginsPortsContext, useAgentPluginsPorts } from '../hooks/AgentPluginsPorts.hooks.js';
import { agentPluginsMessagesEn as m } from '../../messages.en.js';
import type { AgentPluginSummary } from '../../models.js';
import type { AgentPluginsApiPort } from '../../ports.js';

afterEach(cleanup);
const READ = 'admin.plugins.read', WRITE = 'admin.plugins.enable';
const alpha: AgentPluginSummary = { pluginId: 'ui-ux-design', version: null, description: 'Design interfaces', keywords: [], enabled: false, skills: [], mcpServerIds: [] };

function mountPage(api: AgentPluginsApiPort, permissions: readonly string[] = [READ, WRITE]) {
  const feature = agentPlugins({});
  const admin = createAdmin({ modules: [feature], ports: { agentPluginsApi: api } }, { permissions });
  const { Page, tabs } = feature.react.pages.agentPlugins;
  render(<StrictMode><feature.react.Provider admin={admin}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} /></Suspense></feature.react.Provider></StrictMode>);
}

it('shows the load failure as a danger notice when the backend list fails', async () => {
  const api = createMemoryAgentPluginsApi({ plugins: [alpha] });
  mountPage({ ...api, list: async () => { throw new Error('backend down'); } });
  expect(await screen.findByText(m.loadError)).toBeVisible();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByText(m.empty)).toBeNull();
});

it('announces an empty workspace once the list has loaded with no packages', async () => {
  mountPage(createMemoryAgentPluginsApi({ plugins: [] }));
  expect(await screen.findByText(m.empty)).toHaveAttribute('role', 'status');
  expect(screen.queryByText(m.loadError)).toBeNull();
});

it('raises an alert when an enable is refused and keeps the row off', async () => {
  const api = createMemoryAgentPluginsApi({ plugins: [alpha] });
  const refused = vi.fn(async () => { throw new Error('refused'); });
  mountPage({ ...api, setEnabled: refused });
  fireEvent.click(await screen.findByRole('switch', { name: 'Enable UI UX Design' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(m.actionError);
  expect(refused).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('switch', { name: 'Enable UI UX Design' })).not.toBeChecked();
});

it('denies a list tab whose own grants lack read even inside a readable page scope', () => {
  const scope = { controller: null, snapshot: null, permissions: [READ], uninstallNoteId: 'note' };
  render(<AgentPluginsPageContext.Provider value={scope}><AgentPluginListPanel props={{ params: {}, permissions: [] }} mode="installed" /></AgentPluginsPageContext.Provider>);
  expect(screen.getByText(m.denied)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Reload packages' })).toBeNull();
});

it('denies the package inspector without the read grant and never reads files', () => {
  const api = createMemoryAgentPluginsApi({ plugins: [alpha] });
  const files = vi.spyOn(api, 'files');
  const onClose = vi.fn();
  render(<AgentPluginsPortsContext.Provider value={{ agentPluginsApi: api }}><AgentPluginInspector pluginId={alpha.pluginId} name="UI UX Design" permissions={[]} onClose={onClose} /></AgentPluginsPortsContext.Provider>);
  expect(screen.getByRole('dialog', { name: 'UI UX Design — Package files' })).toHaveTextContent(m.denied);
  expect(screen.queryByRole('tree')).toBeNull();
  expect(files).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close package files' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('denies the marketplace tab when mounted without grants', () => {
  render(<MarketplaceTab params={{}} />);
  expect(screen.getByText(m.denied)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Read the package format' })).toBeNull();
});

it('fails loudly when agent-plugin hooks run outside the bound provider', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => renderHook(() => useAgentPluginsPorts())).toThrow(AdminConfigError);
  expect(() => renderHook(() => useAgentPluginsPorts())).toThrow(/React scope unavailable: agent-plugins/);
});
