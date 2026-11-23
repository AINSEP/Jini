import { useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
import type { TabBarTab } from '../../../react/kit.js';
import type { SecurityTranslator } from '../../messages.en.js';
import { useSecurityTranslation, useSecurityOwnerControls } from './SecurityPorts.hooks.js';
/** The shell passes this page its tabs as renderable components. */
type TabbedPageProps = ModulePageProps<ComponentType<TabViewProps>>;
/** Host-supplied tab glyphs; the module ships no icon set. */
export type SecurityTabIcons = Partial<Record<'access-tokens' | 'root-key', ReactNode>>;
/** Stable agent handles and the message keys for each tab. The handle values are kept from the
 * screen this replaces so agents and saved selectors keep addressing the same tabs. */
const TAB_COPY: Readonly<Record<string, { label: string; handleLabel: string; handle: string }>> = {
  'access-tokens': { label: 'accessTokens', handleLabel: 'accessTokensHandleLabel', handle: 'security-tab-access-tokens' },
  'root-key': { label: 'rootKey', handleLabel: 'rootKeyHandleLabel', handle: 'security-tab-site-key' },
};
export const SECURITY_TAB_BAR_HANDLE = 'security-tab-bar';
function tabBarTab({ id, fallbackLabel, t, icons }: { id: string; fallbackLabel: string; t: SecurityTranslator; icons: SecurityTabIcons }, _optional = {}): TabBarTab {
  const copy = TAB_COPY[id], icon = icons[id as keyof SecurityTabIcons];
  if (!copy) return { id, label: fallbackLabel };
  return { id, label: t(copy.label), handle: copy.handle, handleLabel: t(copy.handleLabel), ...(icon === undefined ? {} : { icon }) };
}
/** A hidden or unknown requested tab falls back to the first visible one (Access tokens). */
function activeTab({ description, requested }: { description: TabbedPageProps['description']; requested: string }, _optional = {}) {
  const visible = description.visible ? description.tabs.filter(tab => tab.visible) : [];
  const active = visible.find(tab => tab.id.endsWith(`.${requested}`)) ?? visible[0];
  return { visible, active, id: active?.id.split('.').at(-1) ?? '' };
}
function pageCopy({ t }: { t: SecurityTranslator }, _optional = {}) {
  return { title: t('security'), kicker: t('kicker'), description: t('description'), tabsLabel: t('tabsLabel'), deniedLabel: t('denied'), loadingLabel: t('loading') };
}
export function useSecurityPage(props: TabbedPageProps & { tabIcons?: SecurityTabIcons }, { useSecurityTranslationHook = useSecurityTranslation, useSecurityOwnerControlsHook = useSecurityOwnerControls }: { useSecurityTranslationHook?: typeof useSecurityTranslation; useSecurityOwnerControlsHook?: typeof useSecurityOwnerControls } = {}) {
  const t = useSecurityTranslationHook({}), ownerControls = useSecurityOwnerControlsHook({});
  const [local, setLocal] = useState('access-tokens');
  const { visible, active, id } = activeTab({ description: props.description, requested: props.requestedTab ?? local });
  const icons = props.tabIcons ?? {};
  return { denied: !props.description.visible, active: id, ActiveTab: id ? props.tabs[id] : undefined, params: active?.params ?? {}, permissions: props.description.grants, ownerControls,
    ...pageCopy({ t }),
    tabs: visible.map(tab => tabBarTab({ id: tab.id.split('.').at(-1)!, fallbackLabel: tab.label, t, icons })),
    onValueChange({ value }: { value: string }) { setLocal(value); props.onTabChange?.({ tab: value }); },
  };
}
