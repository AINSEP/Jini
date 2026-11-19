import type { ComponentType } from 'react';
import type { ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
/** The shell passes this page its tabs as renderable components. */
type TabbedPageProps = ModulePageProps<ComponentType<TabViewProps>>;
export function usePlaygroundPage(props: TabbedPageProps, _optional = {}) { const tab = props.description.tabs.find(t => t.visible); return { denied: !props.description.visible, ActiveTab: tab ? props.tabs.canvas : undefined, params: tab?.params ?? {}, permissions: props.description.grants }; }
