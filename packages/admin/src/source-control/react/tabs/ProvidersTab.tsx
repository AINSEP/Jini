import { Button, Notice, Spinner } from '../../../react/kit.js';
import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { useProvidersTab } from '../hooks/ProvidersTab.hooks.js';
import { SourceControlProviderRow } from '../components/SourceControlProviderRow.js';
export function ProvidersTab({ useProvidersTabHook = useProvidersTab, ...props }: TabViewProps & { useProvidersTabHook?: typeof useProvidersTab }, _optional = {}) {
  const vm = useProvidersTabHook(props);
  return vm.denied ? <Notice tone="danger">Permission denied</Notice> : <section>{vm.errors.map(error => <Notice key={error} tone="danger">{error}</Notice>)}{vm.loading && <Spinner label="Loading connections…" />}<Button onPress={vm.reload} disabled={vm.loading}>Reload connections</Button>{vm.rows.map(row => <SourceControlProviderRow key={row.id} row={row} />)}{vm.canManage && <p>Need a second named token or want to rename one? <Button variant="ghost" onPress={vm.manage}>Create access token</Button></p>}</section>;
}
export default ProvidersTab;
