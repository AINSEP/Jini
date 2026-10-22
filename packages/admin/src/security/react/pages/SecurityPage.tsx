import { Suspense } from 'react';
import { Tabs, Notice, Spinner } from '@jini-ai/ui-kit/react';
import type { ModulePageProps } from '../../../core/react/bind-react.js';
import { useSecurityPage } from '../hooks/SecurityPage.hooks.js';
export function SecurityPage(props: ModulePageProps, _optional = {}) {
  const vm = useSecurityPage(props);
  return <section data-jini-part="security.page"><h1>{props.description.label}</h1>{vm.denied ? <Notice tone="danger">Permission denied</Notice> : <><Tabs label="Security views" value={vm.active} items={vm.items} onValueChange={vm.onValueChange} /><Suspense fallback={<Spinner label="Loading credentials…" />}>{vm.ActiveTab && <vm.ActiveTab key={vm.active} params={vm.params} permissions={vm.permissions} />}</Suspense></>}</section>;
}
export default SecurityPage;
