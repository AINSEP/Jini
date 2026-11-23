import { Button, TextField, Notice, ConfirmDialog, Spinner, Badge } from '../../../react/kit.js';
import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { useRootKeyTab } from '../hooks/RootKeyTab.hooks.js';
type RootKeyView = ReturnType<typeof useRootKeyTab>;
function RootKeyMessages({ vm }: { vm: RootKeyView }) {
  return <>{vm.loading && <Spinner label="Loading root key status…" />}{vm.error && <Notice tone="danger">{vm.error}</Notice>}{vm.result && <Notice tone="success">{vm.result}</Notice>}</>;
}
function LockedActions({ vm }: { vm: RootKeyView }) {
  return <><TextField label="Old root key" type="password" value={vm.token} onValueChange={vm.onToken} disabled={vm.saving} attrs={{ 'data-agent-private': 'true' }} /><Button onPress={vm.unlock} pending={vm.saving}>Unlock saved credentials</Button><Button onPress={vm.previewFresh} disabled={vm.saving || vm.loading}>Start fresh</Button></>;
}
function StartFreshBody({ vm }: { vm: RootKeyView }) {
  return <><p>{vm.preview?.detail}</p><p>{vm.preview?.removes} credentials will be removed.</p>{vm.preview?.affectedWebhooks.map(w => <p key={`${w.label}:${w.targetUrl}`}>{w.label} · {w.targetUrl}</p>)}<TextField label="Type START FRESH" value={vm.confirm} onValueChange={vm.onConfirmText} disabled={vm.saving} /></>;
}
/** What the key covers; the production line is added only where the key sits beside the database. */
function RootKeyScopeNotice({ vm }: { vm: RootKeyView }) {
  return <Notice tone="warning"><p>{vm.scopeNotice}</p>{vm.productionNote && <p>{vm.productionNote}</p>}</Notice>;
}
/** Badge, fingerprint (with its hint) and the source note. Rendered once the status has loaded. */
function RootKeyStatusCard({ vm }: { vm: RootKeyView }) {
  if (!vm.status || !vm.badge) return null;
  return <div data-jini-part="security.root-key-status"><p><Badge tone={vm.badge.tone}>{vm.badge.label}</Badge>{vm.status.fingerprint && <span title={vm.fingerprintHint}> {vm.fingerprintLabel} <code>{vm.status.fingerprint}</code></span>}</p>
    {vm.sourceNote && <p>{vm.sourceNote.text}{vm.sourceNote.path !== undefined && <> <code>{vm.sourceNote.path}</code></>}</p>}</div>;
}
export function RootKeyTab({ useRootKeyTabHook = useRootKeyTab, ...props }: TabViewProps & { useRootKeyTabHook?: typeof useRootKeyTab }) {
  const vm = useRootKeyTabHook(props);
  return vm.denied ? <Notice tone="danger">Permission denied</Notice> : <section aria-label="Root key"><RootKeyScopeNotice vm={vm} /><RootKeyMessages vm={vm} />
    <RootKeyStatusCard vm={vm} />{vm.canGenerate && <Button onPress={vm.generate} pending={vm.saving}>Create root key</Button>}
    {vm.locked && <LockedActions vm={vm} />}
    {vm.confirming && <ConfirmDialog open title="Start fresh" body={<StartFreshBody vm={vm} />} consequence="Saved credentials will be removed. Update affected webhook receivers with new signing secrets." confirmLabel="Start fresh" onConfirm={vm.confirmFresh} onCancel={vm.cancelFresh} pending={vm.saving} agentMayConfirm={false} tone="danger" />}
  </section>;
}
export default RootKeyTab;
