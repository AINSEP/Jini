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
/** What this key covers; production adds the backup caveat. */
function RootKeyScopeNotice({ vm }: { vm: RootKeyView }) {
  return <Notice tone="warning"><p>{vm.scopeNotice}</p>{vm.scopeDetail && <p>{vm.scopeDetail}</p>}</Notice>;
}
/** Badge, fingerprint, source note and the create-only action; rendered once the status loads. */
function RootKeyStatusCard({ vm }: { vm: RootKeyView }) {
  if (!vm.status || !vm.badge || !vm.note) return null;
  return <section className="jini-card" aria-label={vm.t('Root key status')}><h3>{vm.t('Root key')}</h3>
    <p><Badge tone={vm.badge.tone}>{vm.badge.label}</Badge>{vm.status.fingerprint && <span title={vm.t('A short ID for this key. It changes if the key changes.')}> {vm.t('Fingerprint')} <code>{vm.status.fingerprint}</code></span>}</p>
    <p>{vm.note.text}{vm.note.path && <> <code>{vm.note.path}</code></>}{vm.note.after && <> {vm.note.after}</>}</p>
    {vm.canGenerate && <Button onPress={vm.generate} pending={vm.saving}>{vm.t('Create root key')}</Button>}
    {vm.generateError && <Notice tone="danger">{vm.generateError}</Notice>}
  </section>;
}
export function RootKeyTab({ useRootKeyTabHook = useRootKeyTab, ...props }: TabViewProps & { useRootKeyTabHook?: typeof useRootKeyTab }) {
  const vm = useRootKeyTabHook(props);
  return vm.denied ? <Notice tone="danger">Permission denied</Notice> : <section aria-label="Root key"><RootKeyScopeNotice vm={vm} /><RootKeyMessages vm={vm} />
    <RootKeyStatusCard vm={vm} />
    {vm.locked && <LockedActions vm={vm} />}
    {vm.confirming && <ConfirmDialog open title="Start fresh" body={<StartFreshBody vm={vm} />} consequence="Saved credentials will be removed. Update affected webhook receivers with new signing secrets." confirmLabel="Start fresh" onConfirm={vm.confirmFresh} onCancel={vm.cancelFresh} pending={vm.saving} agentMayConfirm={false} tone="danger" />}
  </section>;
}
export default RootKeyTab;
