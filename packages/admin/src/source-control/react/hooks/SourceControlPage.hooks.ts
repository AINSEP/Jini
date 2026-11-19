import type { ComponentType } from 'react';
import type { ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
/** The shell passes this page its tabs as renderable components. */
type TabbedPageProps = ModulePageProps<ComponentType<TabViewProps>>;
export function useSourceControlPage(props: TabbedPageProps, _optional = {}) {
  const active = props.description.tabs.find(t => t.visible && t.id.endsWith(`.${props.requestedTab ?? 'providers'}`)) ?? props.description.tabs.find(t => t.visible);
  return { denied: !props.description.visible, ActiveTab: active ? props.tabs.providers : undefined, params: active?.params ?? {}, permissions: props.description.grants, active: 'providers', items: [{ id: 'providers', label: 'Providers', content: null }], onValueChange({ value }: { value: string }) { props.onTabChange?.({ tab: value }); } };
}
