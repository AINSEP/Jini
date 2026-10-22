import { Button, TextField, Select, Notice, ConfirmDialog, Spinner } from '@jini-ai/ui-kit/react';
import type { TabViewProps } from '../../../core/react/bind-react.js';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { CredentialEditor } from '../components/CredentialEditor.js';
export function AccessTokensTab(props: TabViewProps, _optional = {}) {
  const vm = useAccessTokensTab(props);
  return vm.denied ? <Notice tone="danger">Permission denied</Notice> : <section aria-label="Access tokens">
    <TextField label="Search tokens" type="search" value={vm.query} onValueChange={vm.onQuery} /><Select label="Category" value={vm.category} options={vm.categories} onValueChange={vm.onCategory} />
    <p role="status">{vm.matched} of {vm.total} tokens saved</p><Button onPress={vm.reload} disabled={vm.saving}>Reload</Button>
    {vm.loading && <Spinner label="Loading credentials…" />}{vm.errors.map((error, i) => <Notice key={i} tone="danger">{error}</Notice>)}
    {vm.providers.map(p => <section key={`${p.provider.kind}:${p.provider.id}`}><h2>{p.provider.label} · {p.provider.category}</h2><p>{p.provider.help}</p>{p.provider.tokenPageUrl && <a href={p.provider.tokenPageUrl} target="_blank" rel="noreferrer">Manage tokens at {p.provider.vendorLabel}</a>}{p.canWrite && <Button onPress={p.add} disabled={vm.saving}>Add {p.provider.label} token</Button>}</section>)}
    {vm.rows.map(item => <article key={`${item.row.kind}:${item.row.id}`}><h3>{item.label}</h3><p>{item.row.kind} · {item.row.isDefault ? 'Default' : 'Saved'} · {item.row.updatedAt}</p>{item.canWrite && <><Button onPress={item.edit} disabled={vm.saving}>Edit {item.label}</Button>{item.row.kind !== 'custom' && !item.row.isDefault && <Button onPress={item.makeDefault} disabled={vm.saving}>Make default</Button>}<Button onPress={item.remove} disabled={vm.saving}>Remove {item.label}</Button></>}</article>)}
    {vm.otherRows.map(item => <article key={`${item.row.store}:${item.row.id}`}><h3>{item.row.label}</h3><p>Configured{item.row.envNames && <> · {item.row.envNames.length} environment variables set</>}</p>{item.canWrite && <>{item.row.supportsReplace && <><TextField label={`New key for ${item.row.label}`} type="password" value={item.token} onValueChange={item.onToken} disabled={vm.saving} attrs={{ 'data-agent-private': 'true' }} /><Button onPress={item.replace} disabled={vm.saving}>Replace {item.row.label}</Button></>}<Button onPress={item.remove} disabled={vm.saving}>Remove {item.row.label}</Button></>}</article>)}
    {vm.canAddCustom && <Button onPress={vm.addCustom} disabled={vm.saving}>Add custom provider</Button>}
    {vm.draft && <CredentialEditor controller={vm.controller} draft={vm.draft} saving={vm.saving} />}
    {vm.removal && <ConfirmDialog open title="Remove credential" body="Removing this saved connection cannot revoke the token at its provider." consequence="Operations using this connection may stop working. Revoke the token at its provider separately." confirmLabel="Remove credential" onConfirm={vm.confirmRemove} onCancel={vm.cancelRemove} pending={vm.saving} agentMayConfirm={false} tone="danger" />}
  </section>;
}
export default AccessTokensTab;
