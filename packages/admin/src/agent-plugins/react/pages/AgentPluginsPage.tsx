import { Suspense } from 'react';
import { ConfirmDialog, Notice, Spinner, Tabs } from '@jini-ai/ui-kit/react';
import type { ModulePageProps } from '../../../core/react/bind-react.js';
import { AgentPluginsPageContext, useAgentPluginsPage } from '../hooks/AgentPluginsPage.hooks.js';
import { AgentPluginInspector } from '../components/AgentPluginInspector.js';
import { agentPluginsMessagesEn as m } from '../../messages.en.js';
export function AgentPluginsPage(props: ModulePageProps, _optional = {}) {
  const vm = useAgentPluginsPage(props);
  return <section data-jini-part="agent-plugins.page"><h1>{props.description.label}</h1>{vm.denied ? <Notice tone="danger">{m.denied}</Notice> : <AgentPluginsPageContext.Provider value={vm.scope}>
    <p>{m.description}</p><Tabs label="Agent Plugin views" value={vm.activeId} items={vm.items} onValueChange={vm.onValueChange} />
    <Suspense fallback={<Spinner label={m.loading} />}>{vm.ActiveTab && <vm.ActiveTab params={vm.params} permissions={vm.permissions} />}</Suspense>
    {vm.inspector && <AgentPluginInspector key={vm.inspector.pluginId} pluginId={vm.inspector.pluginId} name={vm.inspector.name} permissions={vm.permissions} onClose={vm.closeInspector} />}
    {vm.confirmation && <ConfirmDialog open title={vm.confirmation.title} body={vm.confirmation.body} consequence="Stops this package’s skills on the next assistant run." confirmLabel={vm.confirmation.confirmLabel} cancelLabel="Cancel" tone="warning" pending={vm.confirming} agentMayConfirm={false} onConfirm={vm.confirm} onCancel={vm.cancel} errorLabel={m.actionError} />}
  </AgentPluginsPageContext.Provider>}</section>;
}
export default AgentPluginsPage;
