import { Button, TextField, Select, Notice, ConfirmDialog, Spinner } from '../../../react/kit.js';
import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import { CredentialEditor } from '../components/CredentialEditor.js';
export function AccessTokensTab({ useAccessTokensTabHook = useAccessTokensTab, ...props }: TabViewProps & { useAccessTokensTabHook?: typeof useAccessTokensTab }) {
  const vm = useAccessTokensTabHook(props);
  return vm.denied ? <Notice tone="danger">Permission denied</Notice> : <section aria-label="Access tokens">
    <TextField label="Search tokens" type="search" value={vm.query} onValueChange={vm.onQuery} /><Select label="Category" value={vm.category} options={vm.categories} onValueChange={vm.onCategory} />
    <p role="status">{vm.countText}</p><Button onPress={vm.reload} disabled={vm.saving}>Reload</Button>
    {vm.loading && <Spinner label="Loading credentials…" />}{vm.errors.map((error, i) => <Notice key={i} tone="danger">{error}</Notice>)}
    {vm.hostingEmpty && <p>Enable a hosting plugin to manage its access tokens.</p>}
    {vm.groups.map(g => <section key={g.key}><h2>{g.provider.label} · {g.provider.category}</h2>{g.provider.help && <p>{g.provider.help}</p>}{g.provider.tokenPageUrl && <a href={g.provider.tokenPageUrl} target="_blank" rel="noreferrer">Manage tokens at {g.provider.vendorLabel}</a>}{g.rows.length === 0 && <p>Not connected</p>}
    {g.rows.map(item => <article key={`${item.row.kind}:${item.row.id}`}><h3>{item.label}</h3><p>{item.row.kind} · {item.row.isDefault ? 'Default' : 'Saved'} · {item.row.updatedAt}</p>{item.canWrite && <><Button onPress={item.edit} disabled={vm.saving}>Edit {item.label}</Button>{item.row.kind !== 'custom' && !item.row.isDefault && <Button onPress={item.makeDefault} disabled={vm.saving}>Make default</Button>}<Button onPress={item.remove} disabled={vm.saving}>Remove {item.label}</Button></>}</article>)}
    {g.provider.kind !== 'custom' && !g.provider.unlisted && g.canWrite && <Button onPress={g.add} disabled={vm.saving}>Add {g.provider.label} token</Button>}</section>)}
    {vm.otherRows.map(item => <article key={`${item.row.store}:${item.row.id}`}><h3>{item.row.label}</h3><p>Configured{item.row.envNames && <> · {item.row.envNames.length} environment variables set</>}</p>{item.canWrite && <>{item.row.supportsReplace && <><TextField label={`New key for ${item.row.label}`} type="password" value={item.token} onValueChange={item.onToken} disabled={vm.saving} attrs={{ 'data-agent-private': 'true' }} /><Button onPress={item.replace} disabled={vm.saving}>Replace {item.row.label}</Button></>}<Button onPress={item.remove} disabled={vm.saving}>Remove {item.row.label}</Button></>}</article>)}
    {vm.canAddCustom && <Button onPress={vm.addCustom} disabled={vm.saving}>Add custom provider</Button>}
    {vm.draft && <CredentialEditor controller={vm.controller} draft={vm.draft} saving={vm.saving} />}
    {vm.removal && <ConfirmDialog open title="Remove credential" body="Removing this saved connection cannot revoke the token at its provider." consequence="Operations using this connection may stop working. Revoke the token at its provider separately." confirmLabel="Remove credential" onConfirm={vm.confirmRemove} onCancel={vm.cancelRemove} pending={vm.saving} agentMayConfirm={false} tone="danger" />}
  </section>;
}
export default AccessTokensTab;
