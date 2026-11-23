import { Suspense } from 'react';
import { TabBar, Notice, Spinner } from '../../../react/kit.js';
import type { ComponentType } from 'react';
import type { ModulePageProps, TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { useSecurityPage } from '../hooks/SecurityPage.hooks.js';
/** The shell passes this page its tabs as renderable components. */
type TabbedPageProps = ModulePageProps<ComponentType<TabViewProps>>;
const DESCRIPTION = 'One place to see every access token this install holds, and create, rotate, or remove one without hunting across the screens that created it.';
export function SecurityPage({ useSecurityPageHook = useSecurityPage, ...props }: TabbedPageProps & { useSecurityPageHook?: typeof useSecurityPage }) {
  const vm = useSecurityPageHook(props); const { t } = vm;
  return <section data-jini-part="security.page">
    <header className="jini-page-header"><p className="jini-page-kicker">{t('Operations')}</p><h1>{t(props.description.label)}</h1><p className="jini-page-description">{t(DESCRIPTION)}</p></header>
    {vm.denied ? <Notice tone="danger">{t('Permission denied')}</Notice> : <>{vm.ownerControls}<TabBar ariaLabel={t(props.description.label)} tabs={vm.tabs} activeId={vm.active} onChange={id => vm.onValueChange({ value: id })} containerHandle="security-tab-bar" /><Suspense fallback={<Spinner label={t('Loading credentials…')} />}>{vm.ActiveTab && <vm.ActiveTab key={vm.active} params={vm.params} permissions={vm.permissions} />}</Suspense></>}
  </section>;
}
export default SecurityPage;
