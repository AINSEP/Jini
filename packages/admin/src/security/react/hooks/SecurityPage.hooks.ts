import { useState } from 'react';
import type { ComponentType } from 'react';
import type { ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { useSecurityChrome } from './SecurityPorts.hooks.js';
/** The shell passes this page its tabs as renderable components. */
type TabbedPageProps = ModulePageProps<ComponentType<TabViewProps>>;
/** Stable agent handles; hosts and their agent tooling already address the tabs by these names. */
const TAB_HANDLES: Readonly<Record<string, { handle: string; handleLabel: string }>> = {
  'access-tokens': { handle: 'security-tab-access-tokens', handleLabel: 'Switch to the Access Tokens tab — every access token and other saved credential this install holds, in one place' },
  'root-key': { handle: 'security-tab-site-key', handleLabel: 'Switch to the root key tab' },
};
export function useSecurityPage(props: TabbedPageProps, { useSecurityChromeHook = useSecurityChrome }: { useSecurityChromeHook?: typeof useSecurityChrome } = {}) {
  const [local, setLocal] = useState('access-tokens');
  const { t, tabIcons } = useSecurityChromeHook();
  const visible = props.description.visible ? props.description.tabs.filter(t => t.visible) : [];
  const active = visible.find(t => t.id.endsWith(`.${props.requestedTab ?? local}`)) ?? visible[0];
  const id = active?.id.split('.').at(-1);
  const tabs = visible.map(tab => { const tabId = tab.id.split('.').at(-1)!; const handles = TAB_HANDLES[tabId];
    return { id: tabId, label: t(tab.label), icon: tabIcons[tabId as keyof typeof tabIcons], handle: handles?.handle, handleLabel: handles ? t(handles.handleLabel) : undefined }; });
  return { denied: !props.description.visible, active: id ?? '', ActiveTab: id ? props.tabs[id] : undefined, params: active?.params ?? {}, permissions: props.description.grants, t, tabs,
    onValueChange({ value }: { value: string }) { setLocal(value); props.onTabChange?.({ tab: value }); },
  };
}
