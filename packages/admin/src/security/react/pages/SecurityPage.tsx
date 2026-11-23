import { Suspense } from 'react';
import { TabBar, Notice, Spinner } from '../../../react/kit.js';
import type { ComponentType } from 'react';
import type { ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { useSecurityPage, SECURITY_TAB_BAR_HANDLE, type SecurityTabIcons } from '../hooks/SecurityPage.hooks.js';
/** The shell passes this page its tabs as renderable components. */
type TabbedPageProps = ModulePageProps<ComponentType<TabViewProps>>;
type SecurityView = ReturnType<typeof useSecurityPage>;
function SecurityHeader({ vm }: { vm: SecurityView }) {
  return <header data-jini-part="security.header"><p className="jini-page-kicker">{vm.kicker}</p><h1>{vm.title}</h1><p className="jini-page-description">{vm.description}</p></header>;
}
export function SecurityPage({ useSecurityPageHook = useSecurityPage, ...props }: TabbedPageProps & { tabIcons?: SecurityTabIcons; useSecurityPageHook?: typeof useSecurityPage }) {
  const vm = useSecurityPageHook(props);
  return <section data-jini-part="security.page"><SecurityHeader vm={vm} />{vm.denied ? <Notice tone="danger">{vm.deniedLabel}</Notice> : <>{vm.ownerControls != null && <div data-jini-part="security.owner-controls">{vm.ownerControls}</div>}<TabBar ariaLabel={vm.tabsLabel} tabs={vm.tabs} activeId={vm.active} onChange={(value) => vm.onValueChange({ value })} containerHandle={SECURITY_TAB_BAR_HANDLE} /><Suspense fallback={<Spinner label={vm.loadingLabel} />}>{vm.ActiveTab && <vm.ActiveTab key={vm.active} params={vm.params} permissions={vm.permissions} />}</Suspense></>}</section>;
}
export default SecurityPage;
