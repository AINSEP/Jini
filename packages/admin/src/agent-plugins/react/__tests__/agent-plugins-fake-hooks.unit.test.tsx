import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '../../../__tests__/fetch-query-support.js';
import { AgentPluginFileContent } from '../components/AgentPluginFileContent.js';
import { AgentPluginFileTree } from '../components/AgentPluginFileTree.js';
import { AgentPluginInspector } from '../components/AgentPluginInspector.js';
import { AgentPluginListPanel } from '../components/AgentPluginListPanel.js';
import { AgentPluginRow } from '../components/AgentPluginRow.js';
import type { useAgentPluginFileContent, useAgentPluginFileTree, useAgentPluginInspector } from '../hooks/AgentPluginInspector.hooks.js';
import type { useAgentPluginPanel } from '../hooks/AgentPluginPanel.hooks.js';
import type { useAgentPluginRow } from '../hooks/AgentPluginRow.hooks.js';
import type { useAgentPluginsPage } from '../hooks/AgentPluginsPage.hooks.js';
import type { useMarketplaceTab } from '../hooks/MarketplaceTab.hooks.js';
import { AgentPluginsPage } from '../pages/AgentPluginsPage.js';
import { MarketplaceTab } from '../tabs/MarketplaceTab.js';

/**
 * @file One fake-hook output test per agent-plugins component that takes its hook as a prop
 * (hook-injection rule). Each fake returns text the real hook can never produce, so seeing it rendered
 * proves the injected hook fed the markup, and handler fakes prove events reached the injected hook.
 * A fake returns only the fields its component reads, hence the single `as` in `fake`. The `jini-`
 * class-prefix loop applies when a component moves, so it is not asserted here.
 */
afterEach(cleanup);

const fake = <H extends (...args: never[]) => unknown>(vm: Partial<ReturnType<H>>) => vi.fn((..._args: Parameters<H>) => vm as ReturnType<H>);

// The model types these fields as their exact message literals, so the fakes use those literals.
const LIST_NOTICE = 'Some files are not listed: this package is larger than the viewer’s limits.' as const;
const NO_FILES = 'No files to show for this plugin.' as const;
const LEDE = 'Every plugin installed in this workspace. Only switched-on plugins reach the assistant’s prompt.' as const;

describe('agent-plugins components render from their injected hooks', () => {
  it('AgentPluginFileContent shows the path segments and notice of the fake hook', () => {
    const hook = fake<typeof useAgentPluginFileContent>({ headingId: 'h', segments: [{ text: 'FAKE-SEGMENT', slash: false }], hasContent: false, notice: 'FAKE-NOTICE' });
    render(<AgentPluginFileContent file={{ relativePath: 'real/path' } as never} useAgentPluginFileContentHook={hook} />);
    expect(screen.getByText('FAKE-SEGMENT')).toBeTruthy();
    expect(screen.getByText('FAKE-NOTICE')).toBeTruthy();
    expect(screen.queryByText('real')).toBeNull();
  });

  it('AgentPluginFileTree renders the rows of the fake hook and routes clicks to its handler', () => {
    const onClick = vi.fn();
    const hook = fake<typeof useAgentPluginFileTree>({
      onKeyDown: vi.fn(),
      rows: [{ key: 'k', name: 'FAKE-ROW', depth: 1, setSize: 1, posInSet: 1, expanded: undefined, selected: false, tabIndex: 0, path: 'p', indent: {}, onClick, onFocus: vi.fn(), icon: '*' }] as never,
    });
    render(<AgentPluginFileTree files={[]} selectedPath={null} onOpen={vi.fn()} useAgentPluginFileTreeHook={hook} />);
    fireEvent.click(screen.getByText('FAKE-ROW'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('AgentPluginInspector shows the title, note and status of the fake hook', () => {
    const hook = fake<typeof useAgentPluginInspector>({
      denied: false, title: 'FAKE-TITLE', listNotice: LIST_NOTICE, files: [], selectedPath: null, select: vi.fn(), selected: null, status: { role: 'status', text: NO_FILES },
    });
    render(<AgentPluginInspector pluginId="p" name="n" permissions={[]} onClose={vi.fn()} useAgentPluginInspectorHook={hook} />);
    expect(screen.getByText('FAKE-TITLE')).toBeTruthy();
    expect(screen.getByText(LIST_NOTICE)).toBeTruthy();
    expect(screen.getByText(NO_FILES)).toBeTruthy();
  });

  it('AgentPluginListPanel shows the lede and errors of the fake hook and routes Reload to it', () => {
    const reload = vi.fn();
    const hook = fake<typeof useAgentPluginPanel>({
      denied: false, label: 'l', lede: LEDE, error: null, loading: false, actionError: 'FAKE-ACTION-ERROR', empty: false, reload, rows: [],
      uninstallNoteId: 'u', uninstallNotice: 'FAKE-UNINSTALL', specUrl: 'https://fake.example/spec',
    });
    render(<AgentPluginListPanel props={{ params: {}, permissions: [] }} mode="installed" useAgentPluginPanelHook={hook} />);
    expect(screen.getByText(LEDE)).toBeTruthy();
    expect(screen.getByText('FAKE-ACTION-ERROR')).toBeTruthy();
    fireEvent.click(screen.getByText('Reload packages'));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('AgentPluginRow shows the name, state and action of the fake hook and routes the action to it', () => {
    const act = vi.fn();
    const hook = fake<typeof useAgentPluginRow>({
      glyph: 'g', name: 'FAKE-PLUGIN', version: 'FAKE-VERSION', description: 'FAKE-DESCRIPTION', stateLabel: 'FAKE-STATE', installed: false, canWrite: true, busy: false,
      actionAttrs: { 'data-agent-element': 'a' } as never, actionText: 'FAKE-ACTION', act, expandAttrs: {} as never, expand: vi.fn(), inspectLabel: 'i', inspectAttrs: {} as never, inspect: vi.fn(),
      uninstallLabel: 'u', uninstallAttrs: {} as never, detailId: 'd', detailHidden: true, hasSkills: false, hasServers: false, hasKeywords: false,
    });
    render(<AgentPluginRow row={{ id: 'real-id' } as never} useAgentPluginRowHook={hook} />);
    expect(screen.getByText('FAKE-PLUGIN', { exact: false })).toBeTruthy();
    expect(screen.getByText('FAKE-STATE')).toBeTruthy();
    fireEvent.click(screen.getByText('FAKE-ACTION'));
    expect(act).toHaveBeenCalledOnce();
  });

  it('AgentPluginsPage shows the permission notice of the fake hook', () => {
    const hook = fake<typeof useAgentPluginsPage>({ denied: true });
    render(<AgentPluginsPage description={{ label: 'FAKE-PAGE' } as never} tabs={{}} useAgentPluginsPageHook={hook} />);
    expect(screen.getByText('FAKE-PAGE')).toBeTruthy();
    expect(screen.getByText(/permission/i)).toBeTruthy();
  });

  it('MarketplaceTab links to the spec URL of the fake hook', () => {
    const hook = fake<typeof useMarketplaceTab>({ denied: false, specUrl: 'https://fake.example/spec' });
    render(<MarketplaceTab params={{}} permissions={[]} useMarketplaceTabHook={hook} />);
    expect(screen.getByText('Read the package format').getAttribute('href')).toBe('https://fake.example/spec');
  });
});
