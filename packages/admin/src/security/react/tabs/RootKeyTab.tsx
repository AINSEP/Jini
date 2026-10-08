import { Button, TextField, Notice, ConfirmDialog, Spinner } from '@jini-ai/ui-kit/react';
import type { TabViewProps } from '../../../core/react/bind-react.js';
import { useRootKeyTab } from '../hooks/RootKeyTab.hooks.js';
export function RootKeyTab(props: TabViewProps, _optional = {}) {
  const vm = useRootKeyTab(props);
  return vm.denied ? <Notice tone="danger">Permission denied</Notice> : <section aria-label="Root key"><Notice>{vm.scopeNotice}</Notice>{vm.loading && <Spinner label="Loading root key status…" />}{vm.error && <Notice tone="danger">{vm.error}</Notice>}{vm.result && <Notice tone="success">{vm.result}</Notice>}
    {vm.status && <p>{vm.status.state} · {vm.status.fingerprint} · {vm.status.source}</p>}{vm.canGenerate && <Button onPress={vm.generate} pending={vm.saving}>Create root key</Button>}
    {vm.locked && <><TextField label="Old root key" type="password" value={vm.token} onValueChange={vm.onToken} disabled={vm.saving} attrs={{ 'data-agent-private': 'true' }} /><Button onPress={vm.unlock} pending={vm.saving}>Unlock saved credentials</Button><Button onPress={vm.previewFresh} disabled={vm.saving || vm.loading}>Start fresh</Button></>}
    {vm.confirming && <ConfirmDialog open title="Start fresh" body={<><p>{vm.preview?.detail}</p><p>{vm.preview?.removes} credentials will be removed.</p>{vm.preview?.affectedWebhooks.map(w => <p key={`${w.label}:${w.targetUrl}`}>{w.label} · {w.targetUrl}</p>)}<TextField label="Type START FRESH" value={vm.confirm} onValueChange={vm.onConfirmText} disabled={vm.saving} /></>} consequence="Saved credentials will be removed. Update affected webhook receivers with new signing secrets." confirmLabel="Start fresh" onConfirm={vm.confirmFresh} onCancel={vm.cancelFresh} pending={vm.saving} agentMayConfirm={false} tone="danger" />}
  </section>;
}
export default RootKeyTab;
