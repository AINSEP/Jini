import { Suspense } from 'react';
import { Notice, Spinner } from '@jini-ai/ui-kit/react';
import type { ModulePageProps } from '../../../react/bind-react.js';
import { usePlaygroundPage } from '../hooks/PlaygroundPage.hooks.js';
import { playgroundMessagesEn as m } from '../../messages.en.js';
export function PlaygroundPage(props: ModulePageProps, _optional = {}) {
  const vm = usePlaygroundPage(props);
  return <section data-jini-part="playground.page"><p>{m.studio}</p><h1>{props.description.label}</h1>{vm.denied ? <Notice tone="danger">{m.denied}</Notice> : <><p>{m.description}</p><Suspense fallback={<Spinner label="Loading canvas…" />}>{vm.ActiveTab && <vm.ActiveTab params={vm.params} permissions={vm.permissions} />}</Suspense></>}</section>;
}
export default PlaygroundPage;
