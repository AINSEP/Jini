import { useState } from 'react';
import type { ModulePageProps } from '../../../core/react/bind-react.js';
export function useSecurityPage(props: ModulePageProps, _optional = {}) {
  const [local, setLocal] = useState('access-tokens');
  const visible = props.description.visible ? props.description.tabs.filter(t => t.visible) : [];
  const active = visible.find(t => t.id.endsWith(`.${props.requestedTab ?? local}`)) ?? visible[0];
  const id = active?.id.split('.').at(-1);
  return { denied: !props.description.visible, active: id ?? '', ActiveTab: id ? props.tabs[id] : undefined, params: active?.params ?? {}, permissions: props.description.grants,
    items: visible.map(t => ({ id: t.id.split('.').at(-1)!, label: t.label, content: null })),
    onValueChange({ value }: { value: string }) { setLocal(value); props.onTabChange?.({ tab: value }); },
  };
}
