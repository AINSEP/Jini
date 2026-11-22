import { Suspense } from 'react';
import { Tabs, Notice, Spinner } from '../../../react/kit.js';
import type { ComponentType } from 'react';
import type { ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { useSecurityPage } from '../hooks/SecurityPage.hooks.js';
/** The shell passes this page its tabs as renderable components. */
type TabbedPageProps = ModulePageProps<ComponentType<TabViewProps>>;
export function SecurityPage({ useSecurityPageHook = useSecurityPage, ...props }: TabbedPageProps & { useSecurityPageHook?: typeof useSecurityPage }) {
  const vm = useSecurityPageHook(props);
  return <section data-jini-part="security.page"><h1>{props.description.label}</h1>{vm.denied ? <Notice tone="danger">Permission denied</Notice> : <><Tabs label="Security views" value={vm.active} items={vm.items} onValueChange={vm.onValueChange} /><Suspense fallback={<Spinner label="Loading credentials…" />}>{vm.ActiveTab && <vm.ActiveTab key={vm.active} params={vm.params} permissions={vm.permissions} />}</Suspense></>}</section>;
}
export default SecurityPage;
