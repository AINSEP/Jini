import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useController } from '../../../react/use-controller.js';
import { createAgentPluginFilesController } from '../../controllers/agent-plugin-files.controller.js';
import { useAgentPluginsPorts } from './AgentPluginsPorts.hooks.js';
import type { AgentPluginPackageFile } from '../../models.js';
import { AGENT_PLUGINS_READ, agentPluginFileNotice, selectAgentPluginFile } from '../../rules.js';
import { ancestorFolderPaths, buildPackageFileTree, visiblePackageFileRows, packageFileTreeKeyAction, packageFileIconKind } from '../../package-file-tree.js';
import { agentPluginsMessagesEn as m } from '../../messages.en.js';
export interface AgentPluginInspectorProps { readonly pluginId: string; readonly name: string; readonly permissions: readonly string[]; readonly onClose: (required: Record<string, never>, optional?: Record<string, never>) => void }
export function useAgentPluginInspector({ pluginId, permissions, name }: AgentPluginInspectorProps, _optional = {}) {
  const { agentPluginsApi } = useAgentPluginsPorts({}), key = permissions.join('\0');
  const { controller, snapshot } = useController({ create: () => createAgentPluginFilesController({ api: agentPluginsApi, permissions }), dependencies: [agentPluginsApi, key, pluginId] }, { start: ({ controller }) => { void controller.open({ pluginId }); } });
  // Do not show any stored read tagged with another id, even before the new effect commits.
  const state = snapshot?.pluginId === pluginId ? snapshot : null, files = state?.listing?.files ?? [];
  const selected = selectAgentPluginFile({ files, path: state?.selectedPath ?? '' });
  return { title: `${name} — Package files`, denied: !permissions.includes(AGENT_PLUGINS_READ), files, selected, selectedPath: selected?.relativePath ?? null,
    status: state?.error ? { text: state.error, role: 'alert' as const } : !state || state.loading ? { text: m.filesLoading, role: 'status' as const } : !files.length ? { text: m.filesEmpty, role: 'status' as const } : null,
    listNotice: state?.listing?.truncated ? m.filesTruncated : null,
    select({ path }: { path: string }, _optional = {}) { controller?.select({ path }); },
  };
}
const fileGlyphs = { json: '{}', markdown: 'M↓', javascript: 'JS', typescript: 'TS', config: '⚙', html: '<>', css: '#', image: '▧', shell: '>', text: '¶', file: '▤' };
export function useAgentPluginFileTree({ files, selectedPath, onOpen }: { files: readonly AgentPluginPackageFile[]; selectedPath: string | null; onOpen: (required: { path: string }, optional?: Record<string, never>) => void }, _optional = {}) {
  const tree = buildPackageFileTree({ paths: files.map(f => f.relativePath) }), [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  // Set by keyboard navigation to the tree that received the key, so the effect always has a real element.
  const [focused, setFocused] = useState<string | null>(null), focusWithin = useRef<HTMLElement | null>(null);
  // Expansion is derived from selected ancestors until the viewer explicitly toggles a folder.
  const ancestors = new Set(selectedPath ? ancestorFolderPaths({ filePath: selectedPath }) : []);
  const isExpanded = ({ path }: { path: string }) => toggled.get(path) ?? ancestors.has(path);
  const rows = visiblePackageFileRows({ nodes: tree, isExpanded });
  const visible = (path: string | null) => path !== null && rows.some(r => r.node.path === path);
  const activePath = visible(focused) ? focused : visible(selectedPath) ? selectedPath : rows[0]?.node.path ?? null;
  // Move DOM focus only after keyboard navigation, never when opening the inspector.
  useEffect(() => { const tree = focusWithin.current; if (!tree) return; focusWithin.current = null; Array.from(tree.querySelectorAll<HTMLElement>('[data-tree-path]')).find(el => el.dataset.treePath === activePath)?.focus(); });
  const setExpanded = (path: string, expanded: boolean) => setToggled(current => new Map(current).set(path, expanded));
  return {
    rows: rows.map(row => { const { node } = row, folder = node.kind === 'folder', expanded = folder && isExpanded({ path: node.path }); return { key: `${node.kind}:${node.path}`, name: node.name, path: node.path, depth: row.depth + 1, setSize: row.setSize, posInSet: row.posInSet, expanded: folder ? expanded : undefined, selected: folder ? undefined : node.path === selectedPath, tabIndex: node.path === activePath ? 0 : -1,
      icon: folder ? expanded ? '▾' : '▸' : fileGlyphs[packageFileIconKind({ fileName: node.name })], indent: { paddingInlineStart: `${row.depth * 1.25}rem`, ...(node.kind === 'file' && node.path === selectedPath ? { backgroundColor: 'Highlight', color: 'HighlightText' } : {}) },
      onClick() { setFocused(node.path); if (folder) setExpanded(node.path, !expanded); else onOpen({ path: node.path }); }, onFocus() { setFocused(node.path); },
    }; }),
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (activePath === null) return;
      const action = packageFileTreeKeyAction({ rows, currentPath: activePath, key: event.key, isExpanded });
      if (!action.focus && !action.setExpanded && !action.open) return;
      event.preventDefault(); if (action.setExpanded) setExpanded(action.setExpanded.path, action.setExpanded.expanded); if (action.open) onOpen({ path: action.open }); if (action.focus) { setFocused(action.focus); focusWithin.current = event.currentTarget; }
    },
  };
}
export function useAgentPluginFileContent({ file }: { file: NonNullable<ReturnType<typeof useAgentPluginInspector>['selected']> }, _optional = {}) {
  const [wrap, setWrap] = useState(true), headingId = useId(), notice = agentPluginFileNotice({ file });
  // One grid row per source line keeps gutter numbers aligned when long lines wrap.
  const lines = (file.content ?? '').split('\n').map((text, index) => ({ text, number: index + 1 }));
  return { headingId, path: file.relativePath, segments: file.relativePath.split('/').map((text, i, all) => ({ text, slash: i < all.length - 1 })), notice, hasContent: notice === null, lines, wrap,
    wrapAttrs: { 'aria-pressed': wrap }, wrapText: wrap ? 'Wrap: on' : 'Wrap: off',
    codeStyle: { display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', overflow: 'auto' },
    lineStyle: { whiteSpace: wrap ? 'pre-wrap' as const : 'pre' as const, overflowWrap: wrap ? 'anywhere' as const : 'normal' as const },
    toggleWrap(_required: Record<string, never>, _optional = {}) { setWrap(value => !value); },
  };
}
