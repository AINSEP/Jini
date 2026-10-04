import type { ModulePageProps } from '../../../react/bind-react.js';
export function usePlaygroundPage(props: ModulePageProps, _optional = {}) { const tab = props.description.tabs.find(t => t.visible); return { denied: !props.description.visible, ActiveTab: tab ? props.tabs.canvas : undefined, params: tab?.params ?? {}, permissions: props.description.grants }; }
