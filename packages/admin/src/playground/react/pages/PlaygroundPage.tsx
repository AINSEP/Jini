import { Suspense } from 'react';
import { Notice, Spinner } from '../../../react/kit.js';
import type { ComponentType } from 'react';
import type { ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { usePlaygroundPage } from '../hooks/PlaygroundPage.hooks.js';
import { playgroundMessagesEn as m } from '../../messages.en.js';
/** The shell passes this page its tabs as renderable components. */
type TabbedPageProps = ModulePageProps<ComponentType<TabViewProps>>;
export function PlaygroundPage(props: TabbedPageProps, _optional = {}) {
  const vm = usePlaygroundPage(props);
  return <section data-jini-part="playground.page"><p>{m.studio}</p><h1>{props.description.label}</h1>{vm.denied ? <Notice tone="danger">{m.denied}</Notice> : <><p>{m.description}</p><Suspense fallback={<Spinner label="Loading canvas…" />}>{vm.ActiveTab && <vm.ActiveTab params={vm.params} permissions={vm.permissions} />}</Suspense></>}</section>;
}
export default PlaygroundPage;
