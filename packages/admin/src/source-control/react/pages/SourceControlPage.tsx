import { Suspense } from 'react';
import { Notice, Spinner, Tabs } from '@jini-ai/ui-kit/react';
import type { ModulePageProps } from '../../../react/bind-react.js';
import { useSourceControlPage } from '../hooks/SourceControlPage.hooks.js';
import { sourceControlMessagesEn as m } from '../../messages.en.js';
export function SourceControlPage(props: ModulePageProps, _optional = {}) {
  const vm = useSourceControlPage(props);
  return <section data-jini-part="source-control.page"><p>Operations</p><h1>{props.description.label}</h1>{vm.denied ? <Notice tone="danger">{m.denied}</Notice> : <><p>{m.description}</p><Tabs label="Source control views" value={vm.active} items={vm.items} onValueChange={vm.onValueChange} /><Suspense fallback={<Spinner label={m.loading} />}>{vm.ActiveTab && <vm.ActiveTab params={vm.params} permissions={vm.permissions} />}</Suspense></>}</section>;
}
export default SourceControlPage;
