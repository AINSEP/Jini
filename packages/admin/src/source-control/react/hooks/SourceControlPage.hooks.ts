import type { ModulePageProps } from '../../../core/react/bind-react.js';
export function useSourceControlPage(props: ModulePageProps, _optional = {}) {
  const active = props.description.tabs.find(t => t.visible && t.id.endsWith(`.${props.requestedTab ?? 'providers'}`)) ?? props.description.tabs.find(t => t.visible);
  return { denied: !props.description.visible, ActiveTab: active ? props.tabs.providers : undefined, params: active?.params ?? {}, permissions: props.description.grants, active: 'providers', items: [{ id: 'providers', label: 'Providers', content: null }], onValueChange({ value }: { value: string }) { props.onTabChange?.({ tab: value }); } };
}
