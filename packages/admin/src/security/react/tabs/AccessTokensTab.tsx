import { Button, TextField, Select, Notice, ConfirmDialog, Spinner } from '../../../react/kit.js';
import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import type { useAccessTokensTab } from '../hooks/AccessTokensTab.hooks.js';
import type { useCredentialEditor } from '../hooks/CredentialEditor.hooks.js';
import type { useSharedKeysDialog } from '../hooks/SharedKeysDialog.hooks.js';
import { SharedKeysDialog } from '../components/SharedKeysDialog.js';
import { CredentialEditor } from '../components/CredentialEditor.js';
import { OtherCredentialRow, OtherCredentialPlaceholder } from '../components/OtherCredentialRow.js';
import type { SecurityChipField } from '../components/chip-field.js';
/** Every hook arrives as a required input; `react/bindings.ts` binds them for the module. */
export interface AccessTokensTabHooks { readonly useAccessTokensTabHook: typeof useAccessTokensTab; readonly useCredentialEditorHook: typeof useCredentialEditor; readonly useSharedKeysDialogHook: typeof useSharedKeysDialog }
/** Render slots the host binds (feature-owned, no kit name): its chip field for "Works for". */
export interface AccessTokensTabSlots { readonly ChipField: SecurityChipField }
export function AccessTokensTab({ useAccessTokensTabHook, useCredentialEditorHook, useSharedKeysDialogHook, ChipField, ...props }: TabViewProps & AccessTokensTabHooks & AccessTokensTabSlots) {
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
    {vm.draft && <CredentialEditor controller={vm.controller} draft={vm.draft} saving={vm.saving} t={vm.t} useCredentialEditorHook={useCredentialEditorHook} ChipField={ChipField} />}
    {vm.removal && <ConfirmDialog open title="Remove credential" body={<RemovalBody vm={vm} />} consequence="Operations using this connection may stop working. Revoke the token at its provider separately." confirmLabel={vm.t('removeCredentialConfirm')} onConfirm={vm.confirmRemove} onCancel={vm.cancelRemove} pending={vm.saving} agentMayConfirm={false} tone="danger" />}
  </section>;
}
type TabView = ReturnType<typeof useAccessTokensTab>;
/** One provider (or custom key) group: its saved rows, a "Not connected" line, and the add action. */
function CredentialGroupSection({ group: g, vm }: { group: Extract<TabView['sections'][number], { type: 'access' }>['group']; vm: TabView }) {
  return <section key={g.key}><h2>{g.provider.label} · {g.provider.category}</h2>{g.provider.help && <p>{g.provider.help}</p>}{g.provider.tokenPageUrl && <a href={g.provider.tokenPageUrl} target="_blank" rel="noreferrer">Manage tokens at {g.provider.vendorLabel}</a>}{g.rows.length === 0 && <p>Not connected</p>}
    {g.rows.map(item => <article key={`${item.row.kind}:${item.row.id}`}><h3>{item.label}</h3><p>{item.row.kind} · {item.row.updatedAt}{item.hint && <> · <span translate="no">{item.hint}</span></>}</p>{g.rows.length >= 2 && <DefaultIndicator item={item} vm={vm} />}<KeyUsage usage={item.usage} saving={vm.saving} />{item.canWrite && <><Button onPress={item.edit} disabled={vm.saving}>Edit {item.label}</Button><Button onPress={item.remove} disabled={vm.saving}>Remove {item.label}</Button></>}</article>)}
    {g.provider.kind !== 'custom' && !g.provider.unlisted && g.canWrite && <Button onPress={g.add} disabled={vm.saving}>{vm.t(g.rows.length ? 'addAnotherProviderToken' : 'addProviderToken', { provider: g.provider.label })}</Button>}</section>;
}
type GroupRow = Extract<TabView['sections'][number], { type: 'access' }>['group']['rows'][number];
/** SEC-10: a default only means something once a provider has two saved tokens, so the indicator waits for that quorum.
 * The action names its row: several identical "Make default" buttons can be on screen at once. */
function DefaultIndicator({ item, vm }: { item: GroupRow; vm: TabView }) {
  if (item.row.isDefault) return <span>{vm.t('credentialDefault')}</span>;
  if (!item.canWrite || item.row.kind === 'custom') return null;
  return <Button onPress={item.makeDefault} disabled={vm.saving} attrs={{ 'aria-label': `${vm.t('makeDefault')} — ${item.label}` }}>{vm.t('makeDefault')}</Button>;
}
function RemovalBody({ vm }: { vm: TabView }) {
  if (vm.accessRemoval) return <AccessRemovalBody view={vm.accessRemoval} />;
  return <>{vm.removalBody ?? 'Removing this saved connection cannot revoke the token at its provider.'}</>;
}
/** SEC-10: the removal consequence, the revoke link (to the vendor, not the destination) and the last-token note. */
function AccessRemovalBody({ view }: { view: NonNullable<TabView['accessRemoval']> }) {
  return <><p>{view.body}</p>{view.revoke && <p><a href={view.revoke.href} target="_blank" rel="noreferrer">{view.revoke.text} <span translate="no">{view.revoke.vendor}</span> ↗</a></p>}{view.lastRowNote && <p>{view.lastRowNote}</p>}</>;
}
type KeyUsageView = ReturnType<typeof useAccessTokensTab>['rows'][number]['usage'];
/** SEC-12: where a custom key is stored and, for a project key, which sites use it and the attach/detach action. */
function KeyUsage({ usage, saving }: { usage: KeyUsageView; saving: boolean }) {
  if (!usage) return null;
  return <p><span>{usage.text}</span>{usage.action && <> <Button onPress={usage.action.toggle} disabled={saving || usage.action.saving} attrs={{ 'aria-label': usage.action.label }}>{usage.action.name}</Button></>}
    {'note' in usage && <> <span>{usage.note}</span></>}{'error' in usage && usage.error && <span role="alert"> {usage.error}</span>}</p>;
}
export default AccessTokensTab;
