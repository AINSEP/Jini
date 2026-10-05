import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdmin } from '../../../core/module/index.js';
import { agentPlugins } from '../index.js';
import { createMemoryAgentPluginsApi } from '../../adapters/memory.js';
import { AgentPluginFileTree } from '../components/AgentPluginFileTree.js';
import { useAgentPluginInspector } from '../hooks/AgentPluginInspector.hooks.js';
import { useAgentPluginPanel } from '../hooks/AgentPluginPanel.hooks.js';
import { AgentPluginsPageContext, useAgentPluginsPage, useAgentPluginsPageScope } from '../hooks/AgentPluginsPage.hooks.js';
import type { AgentPluginsPageScope } from '../hooks/AgentPluginsPage.hooks.js';
import { AgentPluginsPortsContext } from '../hooks/AgentPluginsPorts.hooks.js';
import type { ModulePageProps } from '../../../react/bind-react.js';
import { agentPluginsMessagesEn as m } from '../../messages.en.js';
import type { AgentPluginFiles, AgentPluginSummary, AgentPluginsState } from '../../models.js';
import type { AgentPluginsApiPort } from '../../ports.js';

afterEach(cleanup);
const READ = 'admin.plugins.read', WRITE = 'admin.plugins.enable';
const off: AgentPluginSummary = { pluginId: 'ui-ux-design', version: '1.0.0', description: 'Design interfaces', keywords: ['UI'], enabled: false, skills: [{ name: 'design', summary: 'A design skill' }], mcpServerIds: ['design-api'] };
const on: AgentPluginSummary = { ...off, pluginId: 'second', version: null, description: null, skills: [], mcpServerIds: [], keywords: [], enabled: true };
const listing = (files: AgentPluginFiles['files'], truncated = false): AgentPluginFiles => ({ pluginId: off.pluginId, files, truncated, limits: { maxFiles: 200, maxEntries: 2000, maxFileBytes: 5242880, maxTotalBytes: 52428800 } });
const portsWrapper = (api: AgentPluginsApiPort) => ({ children }: { children: ReactNode }) =>
  <AgentPluginsPortsContext.Provider value={{ agentPluginsApi: api }}>{children}</AgentPluginsPortsContext.Provider>;

describe('useAgentPluginInspector', () => {
  const mount = (api: AgentPluginsApiPort, permissions = [READ]) =>
    renderHook(() => useAgentPluginInspector({ pluginId: off.pluginId, name: 'UI UX Design', permissions, onClose: () => {} }), { wrapper: portsWrapper(api) });

  it('reports a failed read as an alert', async () => {
    const api = createMemoryAgentPluginsApi({ plugins: [off] });
    const view = mount({ ...api, files: async () => { throw new Error('down'); } });
    expect(view.result.current.status).toEqual({ text: m.filesLoading, role: 'status' });
    await waitFor(() => expect(view.result.current.status).toEqual({ text: m.fileError, role: 'alert' }));
  });

  it('reports an empty package and no truncation notice', async () => {
    const view = mount(createMemoryAgentPluginsApi({ plugins: [off], files: { [off.pluginId]: listing([]) } }));
    await waitFor(() => expect(view.result.current.status).toEqual({ text: m.filesEmpty, role: 'status' }));
    expect(view.result.current).toMatchObject({ title: 'UI UX Design — Package files', denied: false, files: [], selected: null, selectedPath: null, listNotice: null });
  });

  it('lists files, selects one and flags a truncated listing', async () => {
    const files = [{ relativePath: 'a.md', sizeBytes: 1, content: 'a', omitted: null }, { relativePath: 'b.json', sizeBytes: 2, content: '{}', omitted: null }];
    const view = mount(createMemoryAgentPluginsApi({ plugins: [off], files: { [off.pluginId]: listing(files, true) } }));
    await waitFor(() => expect(view.result.current.files).toHaveLength(2));
    expect(view.result.current).toMatchObject({ status: null, listNotice: m.filesTruncated, selectedPath: 'a.md' });
    act(() => view.result.current.select({ path: 'b.json' }));
    expect(view.result.current.selectedPath).toBe('b.json');
  });

  it('is denied without the read grant', () => {
    expect(mount(createMemoryAgentPluginsApi({}), []).result.current.denied).toBe(true);
  });
});

describe('useAgentPluginFileTree', () => {
  const file = (relativePath: string) => ({ relativePath, sizeBytes: 1, content: 'x', omitted: null });
  const files = [file('docs/guide.md'), file('docs/notes.txt'), file('plugin.json')];
  const item = (name: string) => screen.getByRole('treeitem', { name });

  it('ignores keys on an empty tree', () => {
    render(<AgentPluginFileTree files={[]} selectedPath={null} onOpen={() => {}} />);
    expect(fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown' })).toBe(true);
  });

  it('toggles folders and opens files on click', () => {
    const onOpen = vi.fn();
    render(<AgentPluginFileTree files={files} selectedPath={null} onOpen={onOpen} />);
    expect(screen.queryByRole('treeitem', { name: 'guide.md' })).toBeNull();
    fireEvent.click(item('docs'));
    expect(item('docs')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(item('guide.md'));
    expect(onOpen).toHaveBeenCalledWith({ path: 'docs/guide.md' });
    expect(item('guide.md')).toHaveAttribute('tabindex', '0');
    fireEvent.click(item('docs'));
    expect(screen.queryByRole('treeitem', { name: 'guide.md' })).toBeNull();
  });

  it('moves DOM focus with the arrow keys, expands folders and opens files from the keyboard', () => {
    const onOpen = vi.fn();
    render(<AgentPluginFileTree files={files} selectedPath={null} onOpen={onOpen} />);
    const tree = screen.getByRole('tree');
    expect(fireEvent.keyDown(tree, { key: 'x' })).toBe(true);
    act(() => item('docs').focus());
    expect(fireEvent.keyDown(tree, { key: 'ArrowRight' })).toBe(false);
    expect(item('docs')).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).toBe(item('docs'));
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('guide.md'));
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith({ path: 'docs/guide.md' });
  });

  it('starts keyboard navigation from the selected file', () => {
    render(<AgentPluginFileTree files={files} selectedPath="docs/notes.txt" onOpen={() => {}} />);
    expect(item('notes.txt')).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item('guide.md'));
  });
});

describe('useAgentPluginPanel', () => {
  function scope(snapshot: Partial<AgentPluginsState> | null, { permissions = [READ, WRITE], withController = true } = {}) {
    const controller = { requestDisable: vi.fn(), setEnabled: vi.fn(async () => true), toggleExpanded: vi.fn(), inspect: vi.fn(), load: vi.fn(async () => {}) };
    const state: AgentPluginsState | null = snapshot && { plugins: null, loading: false, error: null, actionError: null, busyIds: [], expandedIds: [], pendingDisable: null, inspectedId: null, ...snapshot };
    const value = { controller: withController ? controller : null, snapshot: state, permissions, uninstallNoteId: 'note' } as unknown as AgentPluginsPageScope;
    return { controller, value };
  }
  function mount(value: AgentPluginsPageScope, { mode = 'installed' as 'installed' | 'downloaded', permissions = [READ, WRITE] as string[] | null, params = {} as Record<string, unknown> } = {}) {
    const wrapper = ({ children }: { children: ReactNode }) => <AgentPluginsPageContext.Provider value={value}>{children}</AgentPluginsPageContext.Provider>;
    return renderHook(() => useAgentPluginPanel({ props: { params, ...(permissions === null ? {} : { permissions }) }, mode }), { wrapper });
  }

  it('is loading before the first read and denied without both read grants', () => {
    expect(mount(scope(null).value).result.current).toMatchObject({ denied: false, loading: true, empty: false, rows: [], error: undefined });
    expect(mount(scope(null).value, { permissions: null }).result.current.denied).toBe(true);
    expect(mount(scope({ plugins: [off] }, { permissions: [] }).value).result.current).toMatchObject({ denied: true, rows: [] });
  });

  it('shows a failed read, and an empty list once read', () => {
    expect(mount(scope({ error: 'down' }).value).result.current).toMatchObject({ loading: false, error: 'down', empty: false });
    expect(mount(scope({ plugins: [] }).value).result.current).toMatchObject({ loading: false, empty: true });
  });

  it('describes rows with busy and expanded state', () => {
    const { result } = mount(scope({ plugins: [off, on], busyIds: ['second'], expandedIds: ['ui-ux-design'] }).value);
    expect(result.current.rows[0]).toMatchObject({ id: 'ui-ux-design', name: 'UI UX Design', enabled: false, stateLabel: 'Disabled', busy: false, expanded: true, canWrite: true,
      toggleLabel: 'Enable UI UX Design', actionText: 'Enable', hasSkills: true, hasKeywords: true, hasServers: true,
      expandAttrs: { 'aria-label': 'Collapse UI UX Design', 'aria-expanded': true, 'data-agent-handle': 'agent-plugin-ui-ux-design-expand' }, uninstallAttrs: { 'aria-describedby': 'note' } });
    expect(result.current.rows[1]).toMatchObject({ stateLabel: 'Enabled', busy: true, expanded: false, actionText: 'Turn off', hasSkills: false, hasKeywords: false, hasServers: false });
    expect(result.current).toMatchObject({ lede: m.installedLede, label: 'Installed Agent Plugins', uninstallNotice: m.uninstallUnavailable, uninstallNoteId: 'note' });
  });

  it('enables directly and asks before turning off, per tab', () => {
    const installed = scope({ plugins: [off, on] });
    const panel = mount(installed.value).result.current;
    panel.rows[0]!.toggle({ checked: true });
    panel.rows[0]!.act({});
    expect(installed.controller.setEnabled.mock.calls).toEqual([[{ pluginId: 'ui-ux-design', enabled: true }], [{ pluginId: 'ui-ux-design', enabled: true }]]);
    panel.rows[1]!.toggle({ checked: false });
    expect(installed.controller.requestDisable).toHaveBeenCalledWith({ pluginId: 'second', variant: 'disable' });
    const downloaded = scope({ plugins: [on] });
    const tab = mount(downloaded.value, { mode: 'downloaded', params: { uninstallNotice: 'Host notice' } }).result.current;
    tab.rows[0]!.act({});
    expect(downloaded.controller.requestDisable).toHaveBeenCalledWith({ pluginId: 'second', variant: 'remove' });
    expect(tab).toMatchObject({ label: 'Downloaded Agent Plugins', uninstallNotice: 'Host notice' });
  });

  it('expands, inspects and reloads through the controller', () => {
    const { controller, value } = scope({ plugins: [off] });
    const panel = mount(value).result.current;
    panel.rows[0]!.expand({}); panel.rows[0]!.inspect({}); panel.reload({});
    expect(controller.toggleExpanded).toHaveBeenCalledWith({ pluginId: 'ui-ux-design' });
    expect(controller.inspect).toHaveBeenCalledWith({ pluginId: 'ui-ux-design' });
    expect(controller.load).toHaveBeenCalledWith({});
  });

  it('refuses activation changes without the write grant', () => {
    const { controller, value } = scope({ plugins: [off, on] }, { permissions: [READ] });
    const panel = mount(value).result.current;
    panel.rows.forEach(row => { row.toggle({ checked: true }); row.act({}); });
    expect(panel.rows[0]!.canWrite).toBe(false);
    expect(controller.setEnabled).not.toHaveBeenCalled();
    expect(controller.requestDisable).not.toHaveBeenCalled();
  });

  it('keeps handlers inert without a controller', () => {
    const panel = mount(scope({ plugins: [off, on] }, { withController: false }).value).result.current;
    expect(() => { panel.rows.forEach(row => { row.toggle({ checked: true }); row.expand({}); row.inspect({}); }); panel.reload({}); }).not.toThrow();
  });
});

describe('useAgentPluginsPage', () => {
  function mount({ grants = [READ, WRITE], requestedTab, onTabChange, api = createMemoryAgentPluginsApi({ plugins: [off, on] }) }: {
    grants?: string[]; requestedTab?: string; onTabChange?: ModulePageProps['onTabChange']; api?: AgentPluginsApiPort;
  } = {}) {
    const feature = agentPlugins({});
    const admin = createAdmin({ modules: [feature], ports: { agentPluginsApi: api } }, { permissions: grants });
    const { tabs } = feature.react.pages.agentPlugins;
    let first: ReturnType<typeof useAgentPluginsPage> | undefined;
    const props: ModulePageProps = { tabs, description: admin.describe().pages[0]!, ...(requestedTab ? { requestedTab } : {}), ...(onTabChange ? { onTabChange } : {}) };
    const view = renderHook(() => { const vm = useAgentPluginsPage(props); first ??= vm; return vm; }, { wrapper: portsWrapper(api) });
    return { ...view, api, first: () => first! };
  }
  const loaded = (view: ReturnType<typeof mount>) => waitFor(() => expect(view.result.current.scope.snapshot?.plugins).not.toBeNull());

  it('requires the page scope provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAgentPluginsPageScope({}))).toThrow('Agent plugins page scope unavailable');
    vi.mocked(console.error).mockRestore();
  });

  it('is denied with no tabs when the page is hidden', () => {
    expect(mount({ grants: [] }).result.current).toMatchObject({ denied: true, items: [], activeId: 'installed', ActiveTab: undefined, params: {}, permissions: [] });
  });

  it('switches tabs locally and tells the host when it listens', async () => {
    const plain = mount();
    expect(plain.result.current.items.map(item => item.id)).toEqual(['installed', 'downloaded', 'marketplace']);
    act(() => plain.result.current.onValueChange({ value: 'downloaded' }));
    expect(plain.result.current.activeId).toBe('downloaded');
    cleanup();
    const onTabChange = vi.fn();
    const routed = mount({ requestedTab: 'marketplace', onTabChange });
    expect(routed.result.current.activeId).toBe('marketplace');
    act(() => routed.result.current.onValueChange({ value: 'installed' }));
    expect(onTabChange).toHaveBeenCalledWith({ tab: 'installed' });
  });

  it('opens and closes the inspector for a listed package', async () => {
    const view = mount();
    await loaded(view);
    expect(view.result.current.inspector).toBeNull();
    act(() => view.result.current.scope.controller!.inspect({ pluginId: 'ui-ux-design' }));
    expect(view.result.current.inspector).toEqual({ pluginId: 'ui-ux-design', name: 'UI UX Design' });
    act(() => view.result.current.closeInspector({}));
    expect(view.result.current.inspector).toBeNull();
  });

  it('confirms or cancels a pending disable', async () => {
    const view = mount();
    await loaded(view);
    act(() => view.result.current.scope.controller!.requestDisable({ pluginId: 'second', variant: 'disable' }));
    expect(view.result.current).toMatchObject({ confirmation: { confirmLabel: 'Disable' }, confirming: false });
    act(() => view.result.current.cancel({}));
    expect(view.result.current.confirmation).toBeNull();
    act(() => view.result.current.scope.controller!.requestDisable({ pluginId: 'second', variant: 'remove' }));
    await act(async () => view.result.current.confirm({}));
    expect(view.result.current.scope.snapshot?.plugins?.find(p => p.pluginId === 'second')?.enabled).toBe(false);
  });

  it('throws when the disable is refused, and before the controller exists', async () => {
    const api = createMemoryAgentPluginsApi({ plugins: [off, on] });
    const view = mount({ api: { ...api, setEnabled: async () => { throw new Error('locked'); } } });
    await expect(view.first().confirm({})).rejects.toThrow('Activation was not updated');
    expect(() => { view.first().closeInspector({}); view.first().cancel({}); }).not.toThrow();
    await loaded(view);
    act(() => view.result.current.scope.controller!.requestDisable({ pluginId: 'second', variant: 'disable' }));
    await act(async () => { await expect(view.result.current.confirm({})).rejects.toThrow('Activation was not updated'); });
  });
});
