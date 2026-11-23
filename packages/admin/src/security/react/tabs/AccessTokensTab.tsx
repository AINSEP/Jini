import { Button, TextField, Select, Notice, ConfirmDialog, Spinner } from '../../../react/kit.js';
import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import type { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import type { useCredentialEditor } from '../hooks/CredentialEditor.hooks.js';
import type { useSharedKeysDialog } from '../hooks/SharedKeysDialog.hooks.js';
import { SharedKeysDialog } from '../components/SharedKeysDialog.js';
import { CredentialEditor } from '../components/CredentialEditor.js';
import { OtherCredentialRow, OtherCredentialPlaceholder } from '../components/OtherCredentialRow.js';
/** Every hook arrives as a required input; `react/bindings.ts` binds them for the module. */
export interface AccessTokensTabHooks { readonly useAccessTokensTabHook: typeof useAccessTokensTab; readonly useCredentialEditorHook: typeof useCredentialEditor; readonly useSharedKeysDialogHook: typeof useSharedKeysDialog }
export function AccessTokensTab({ useAccessTokensTabHook, useCredentialEditorHook, useSharedKeysDialogHook, ...props }: TabViewProps & AccessTokensTabHooks) {
  const vm = useAccessTokensTabHook(props);
  return vm.denied ? <Notice tone="danger">Permission denied</Notice> : <section aria-label="Access tokens">
    <TextField label="Search tokens" type="search" value={vm.query} onValueChange={vm.onQuery} /><Select label="Category" value={vm.category} options={vm.categories} onValueChange={vm.onCategory} />
    <p role="status">{vm.countText}</p><Button onPress={vm.reload} disabled={vm.saving}>Reload</Button>
    {vm.loading && <Spinner label="Loading credentials…" />}{vm.errors.map((error, i) => <Notice key={i} tone="danger">{error}</Notice>)}
    {vm.sharedKeys && <SharedKeysDialog {...vm.sharedKeys} useSharedKeysDialogHook={useSharedKeysDialogHook} />}
    {vm.hostingEmpty && <p>{vm.t('hostingEmpty')}{vm.pluginsHref && <> <a href={vm.pluginsHref}>{vm.t('hostingEmptyLink')}</a></>}</p>}
    {vm.sections.map(section => section.type === 'other' ? <OtherCredentialRow key={section.key} item={section.item} saving={vm.saving} t={vm.t} /> : <CredentialGroupSection key={section.key} group={section.group} vm={vm} />)}
    {vm.otherPlaceholders.map(item => <OtherCredentialPlaceholder key={item.key} item={item} t={vm.t} />)}
    {vm.canAddCustom && <Button onPress={vm.addCustom} disabled={vm.saving}>Add custom provider</Button>}
    {vm.draft && <CredentialEditor controller={vm.controller} draft={vm.draft} saving={vm.saving} t={vm.t} useCredentialEditorHook={useCredentialEditorHook} />}
    {vm.removal && <ConfirmDialog open title="Remove credential" body={vm.removalBody ?? "Removing this saved connection cannot revoke the token at its provider."} consequence="Operations using this connection may stop working. Revoke the token at its provider separately." confirmLabel="Remove credential" onConfirm={vm.confirmRemove} onCancel={vm.cancelRemove} pending={vm.saving} agentMayConfirm={false} tone="danger" />}
  </section>;
}
type TabView = ReturnType<typeof useAccessTokensTab>;
/** One provider (or custom key) group: its saved rows, a "Not connected" line, and the add action. */
function CredentialGroupSection({ group: g, vm }: { group: Extract<TabView['sections'][number], { type: 'access' }>['group']; vm: TabView }) {
  return <section key={g.key}><h2>{g.provider.label} · {g.provider.category}</h2>{g.provider.help && <p>{g.provider.help}</p>}{g.provider.tokenPageUrl && <a href={g.provider.tokenPageUrl} target="_blank" rel="noreferrer">Manage tokens at {g.provider.vendorLabel}</a>}{g.rows.length === 0 && <p>Not connected</p>}
    {g.rows.map(item => <article key={`${item.row.kind}:${item.row.id}`}><h3>{item.label}</h3><p>{item.row.kind} · {item.row.isDefault ? 'Default' : 'Saved'} · {item.row.updatedAt}{item.hint && <> · <span translate="no">{item.hint}</span></>}</p><KeyUsage usage={item.usage} saving={vm.saving} />{item.canWrite && <><Button onPress={item.edit} disabled={vm.saving}>Edit {item.label}</Button>{item.row.kind !== 'custom' && !item.row.isDefault && <Button onPress={item.makeDefault} disabled={vm.saving}>Make default</Button>}<Button onPress={item.remove} disabled={vm.saving}>Remove {item.label}</Button></>}</article>)}
    {g.provider.kind !== 'custom' && !g.provider.unlisted && g.canWrite && <Button onPress={g.add} disabled={vm.saving}>{vm.t(g.rows.length ? 'addAnotherProviderToken' : 'addProviderToken', { provider: g.provider.label })}</Button>}</section>;
}
type KeyUsageView = ReturnType<typeof useAccessTokensTab>['rows'][number]['usage'];
/** SEC-12: where a custom key is stored and, for a project key, which sites use it and the attach/detach action. */
function KeyUsage({ usage, saving }: { usage: KeyUsageView; saving: boolean }) {
  if (!usage) return null;
  return <p><span>{usage.text}</span>{usage.action && <> <Button onPress={usage.action.toggle} disabled={saving || usage.action.saving} attrs={{ 'aria-label': usage.action.label }}>{usage.action.name}</Button></>}
    {'note' in usage && <> <span>{usage.note}</span></>}{'error' in usage && usage.error && <span role="alert"> {usage.error}</span>}</p>;
}
export default AccessTokensTab;
