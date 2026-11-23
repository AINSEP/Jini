import { useState } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { createAccessTokensController } from '../../controllers/access-tokens.controller.js';
import { createOtherCredentialsController } from '../../controllers/other-credentials.controller.js';
import type { CredentialSummary, OtherCredentialSummary, CredentialCategory, CredentialKind, CredentialProvider } from '../../models.js';
import { CATEGORIES, credentialCategory, credentialCountText, credentialLabel, filterCredentials, filterOtherCredentials, providerMatchesQuery, providersWithSavedRows, sortCredentialGroups, writePermission, formatTokenHint } from '../../rules.js';
import { noOtherCredentials, useSecurityPorts, useSecurityTranslation, useSecurityCredentialsHost, type SecurityCredentialsHost } from './SecurityPorts.hooks.js';
import { otherCredentialItems, otherPlaceholderItems, otherRemovalBody, type OtherRowHost } from '../components/other-credential-rows.js';
import type { SecurityTranslator } from '../../messages.en.js';
type AccessController = ReturnType<typeof createAccessTokensController>;
type AccessSnapshot = ReturnType<AccessController['getSnapshot']>;
type OtherController = ReturnType<typeof createOtherCredentialsController>;
type OtherSnapshot = ReturnType<OtherController['getSnapshot']>;
type Removal = { row: CredentialSummary | OtherCredentialSummary; type: 'access' | 'other' };
interface RowScope { permissions: readonly string[]; query: string; category: CredentialCategory | 'all'; setRemoval: (removal: Removal) => void }
function currentFilter({ snapshot: s }: { snapshot: AccessSnapshot | null }, _optional = {}) { return { query: s?.query ?? '', category: s?.category ?? 'all' }; }
function accessRows({ snapshot: s, controller, scope }: { snapshot: AccessSnapshot | null; controller: AccessController | null; scope: RowScope }, _optional = {}) {
  if (!s) return [];
  const { permissions, query, category, setRemoval } = scope;
  return filterCredentials({ rows: s.rows, providers: s.providers, query, category }).map(row => ({ row, label: credentialLabel({ row, providers: s.providers }, { rows: s.rows }), verification: s.verifications[`${row.kind}:${row.id}`] ?? row.lastVerification ?? null, canWrite: permissions.includes(writePermission({ kind: row.kind })), edit() { controller?.begin({ row }); }, remove() { setRemoval({ row, type: 'access' }); }, makeDefault() { void controller?.makeDefault({ row }); } }));
}
type AccessRow = ReturnType<typeof accessRows>[number];
/** SEC-12: each row's masked hint and, for a project key, where it is used and the attach/detach action. */
function withKeyFacts({ rows, snapshot: s, controller, t, canAttach }: { rows: readonly AccessRow[]; snapshot: AccessSnapshot | null; controller: AccessController | null; t: SecurityTranslator; canAttach: boolean }, _optional = {}) {
  return rows.map(item => ({ ...item, hint: formatTokenHint({ hint: item.row.tokenHint }, { t }), usage: keyUsage({ item, busy: s?.keyUse[item.row.id], controller, t, canAttach }) }));
}
function keyUsage({ item: { row, label, canWrite }, busy, controller, t, canAttach }: { item: AccessRow; busy: { saving: boolean; failed: boolean } | undefined; controller: AccessController | null; t: SecurityTranslator; canAttach: boolean }, _optional = {}) {
  if (row.kind !== 'custom' || !row.scope) return null;
  if (row.scope !== 'project') return { text: t('keyThisSiteOnly'), action: null };
  return projectKeyUsage({ row, busy, t }, { action: canAttach && canWrite ? keyAction({ row, label, saving: busy?.saving === true, controller, t }) : null });
}
function projectKeyUsage({ row, busy, t }: { row: CredentialSummary; busy: { saving: boolean; failed: boolean } | undefined; t: SecurityTranslator }, { action }: { action: ReturnType<typeof keyAction> | null }) {
  const sites = row.usedBy ?? [];
  return { text: sites.length ? t('keyProjectUsedBy', { sites: sites.join(', ') }) : t('keyProjectUnused'), action, note: t('keyRevokeNote'), error: busy?.failed ? t('keyUseFailed') : null };
}
/** Attach when this site does not use the key yet, detach when it does. */
function keyAction({ row, label, saving, controller, t }: { row: CredentialSummary; label: string; saving: boolean; controller: AccessController | null; t: SecurityTranslator }, _optional = {}) {
  const name = t(row.usedByThisSite ? 'keyStopUsing' : 'keyUse');
  return { name, label: `${name} — ${label}`, saving, toggle() { void controller?.attachKey({ row, use: !row.usedByThisSite }); } };
}
type OtherRowItem = ReturnType<typeof otherView>['otherRows'][number];
/** SEC-9: one ordering across every store. Each other-store row is its own group, sorted with the rest. */
function credentialSections<G extends ReturnType<typeof credentialGroups>[number]>({ groups, otherRows }: { groups: readonly G[]; otherRows: readonly OtherRowItem[] }, _optional = {}) {
  const other = otherRows.map(item => ({ type: 'other' as const, key: `other:${item.key}`, provider: { label: item.row.label, category: item.row.category }, rows: [item], item }));
  return sortCredentialGroups({ groups: [...groups.map(group => ({ type: 'access' as const, key: group.key, provider: group.provider, rows: group.rows, group })), ...other] });
}
/** SEC-12: the Shared Keys entry renders only with the custom write grant and a host Shared Keys port. */
function sharedKeysEntry({ api, permissions, t, onGranted }: { api: ReturnType<typeof useSecurityPorts>['securityApi']; permissions: readonly string[]; t: SecurityTranslator; onGranted: () => void }, _optional = {}) {
  return api.sharedKeys && permissions.includes('custom-credentials.write') ? { port: api.sharedKeys, permissions, t, onGranted } : null;
}
/** A custom row is its own group; a catalog or unlisted provider groups its saved rows. */
export type CredentialGroupProvider = Pick<CredentialProvider, 'id' | 'label' | 'category'> & Partial<Omit<CredentialProvider, 'kind'>> & { readonly kind: CredentialKind };
/** Merged groups across the publish, source-control and custom stores, in the shared sort order. */
function credentialGroups<R extends AccessRow>({ snapshot: s, rows, controller, scope }: { snapshot: AccessSnapshot | null; rows: readonly R[]; controller: AccessController | null; scope: Omit<RowScope, 'setRemoval'> }, _optional = {}) {
  if (!s) return [];
  const { permissions, query, category } = scope;
  const listed = providersWithSavedRows({ providers: s.providers, rows: s.rows }).map(provider => ({ key: `${provider.kind}:${provider.id}`, provider: provider as CredentialGroupProvider, rows: rows.filter(v => v.row.kind === provider.kind && v.row.providerId === provider.id),
    canWrite: permissions.includes(writePermission({ kind: provider.kind })), add() { controller?.begin({ kind: provider.kind, providerId: provider.id }); } }));
  const custom = rows.filter(v => v.row.kind === 'custom').map(v => ({ key: `custom:${v.row.id}`, provider: { kind: 'custom' as const, id: v.row.id, label: v.label, category: credentialCategory({ row: v.row }) } as CredentialGroupProvider, rows: [v], canWrite: v.canWrite, add() {} }));
  const visible = listed.filter(g => (category === 'all' || g.provider.category === category) && (g.rows.length > 0 || providerMatchesQuery({ provider: g.provider, query })));
  return sortCredentialGroups({ groups: [...visible, ...custom] });
}
/** The hosting filter can be empty while source-control groups still exist. */
function hostingEmpty({ snapshot: s, groups, query, category }: { snapshot: AccessSnapshot | null; groups: ReturnType<typeof credentialGroups>; query: string; category: CredentialCategory | 'all' }, _optional = {}) {
  return s?.loading === false && !query && (category === 'all' || category === 'hosting') && !groups.some(g => g.provider.category === 'hosting');
}
/** SEC-13 other stores: configured rows, settled-empty placeholders, and the per-store removal consequence. */
function otherView({ snapshot: o, controller, scope, host, removal }: { snapshot: OtherSnapshot | null; controller: OtherController | null; scope: RowScope; host: OtherRowHost; removal: Removal | null }, _optional = {}) {
  const { permissions, query, category, setRemoval } = scope;
  return { otherRows: otherCredentialItems({ snapshot: o, controller, scope: { permissions, query, category, onRemove: row => setRemoval({ row, type: 'other' }) }, host }),
    otherPlaceholders: otherPlaceholderItems({ snapshot: o, scope: { permissions, query, category }, host }),
    removalBody: removal?.type === 'other' ? otherRemovalBody({ row: removal.row as OtherCredentialSummary, t: host.t }) : null };
}
/** The catalog (or unlisted) provider a saved row belongs to; a custom row is its own provider. */
function removalProvider({ row, snapshot: s }: { row: CredentialSummary; snapshot: AccessSnapshot }, _optional = {}) {
  return row.kind === 'custom' ? undefined : providersWithSavedRows({ providers: s.providers, rows: s.rows }).find(p => p.kind === row.kind && p.id === row.providerId);
}
/** The name the dialog uses and whether this is the provider's only saved token (custom rows have no provider to empty). */
function removalFacts({ row, provider, snapshot: s }: { row: CredentialSummary; provider: CredentialProvider | undefined; snapshot: AccessSnapshot }, _optional = {}) {
  const label = provider?.label ?? credentialLabel({ row, providers: s.providers }, { rows: s.rows });
  return { label, last: provider !== undefined && s.rows.filter(r => r.kind === row.kind && r.providerId === row.providerId).length === 1 };
}
function revokeLink({ provider, t }: { provider: CredentialProvider | undefined; t: SecurityTranslator }, _optional = {}) {
  return provider?.tokenPageUrl ? { href: provider.tokenPageUrl, text: t('removeRevokeOn'), vendor: provider.vendorLabel } : null;
}
/** SEC-10: what removing a saved access token means. It deletes the saved copy only; the revoke link names
 * the vendor (where the token is revoked), and the last saved token for a provider says so. */
function accessRemovalView({ removal, snapshot: s, t }: { removal: Removal | null; snapshot: AccessSnapshot | null; t: SecurityTranslator }, _optional = {}) {
  if (removal?.type !== 'access' || !s) return null;
  const row = removal.row as CredentialSummary, provider = removalProvider({ row, snapshot: s });
  const { label, last } = removalFacts({ row, provider, snapshot: s });
  return { body: t('removeCredentialBody', { credentialLabel: label, vendor: provider?.vendorLabel ?? label }), revoke: revokeLink({ provider, t }),
    lastRowNote: last ? t('removeLastRowNote', { provider: label }) : null };
}
/** SEC-14: both controllers take the host's refresh subscription and failure describer. */
function hostOptions({ host }: { host: SecurityCredentialsHost }, _optional = {}) {
  return { refreshSignal: host.refreshSignal, describeError: host.describeError };
}
function providerOptions({ snapshot: s, controller, scope }: { snapshot: AccessSnapshot | null; controller: AccessController | null; scope: Omit<RowScope, 'setRemoval'> }, _optional = {}) {
  const { permissions, query, category } = scope;
  return (s?.providers ?? []).filter(p => (category === 'all' || p.category === category) && `${p.label} ${p.id}`.toLowerCase().includes(query.trim().toLowerCase())).map(provider => ({ provider, canWrite: permissions.includes(writePermission({ kind: provider.kind })), add() { controller?.begin({ kind: provider.kind, providerId: provider.id }); } }));
}
function tokenCounts({ access: s, other: o, query }: { access: AccessSnapshot | null; other: OtherSnapshot | null; query: string }, _optional = {}) {
  // Count remains global across categories; the search count answers how many saved tokens this host holds.
  const total = (s?.rows.length ?? 0) + (o?.rows.length ?? 0);
  const matched = (s ? filterCredentials({ rows: s.rows, providers: s.providers, query, category: 'all' }).length : 0) + (o ? filterOtherCredentials({ rows: o.rows, query, category: 'all' }).length : 0);
  return { total, matched };
}
function tabStatus({ access: s, other: o }: { access: AccessSnapshot | null; other: OtherSnapshot | null }, _optional = {}) {
  return { loading: s?.loading ?? true, saving: (s?.saving ?? false) || (o?.saving ?? false) };
}
function errorList({ access: s, other: o, t }: { access: AccessSnapshot | null; other: OtherSnapshot | null; t: SecurityTranslator }, _optional = {}) {
  // Controller messages are English keys; a host translator relabels them with the rest of the page.
  return [...(s?.error ? [s.error] : []), ...Object.values(s?.errors ?? {}), ...Object.values(o?.errors ?? {})].map(message => t(message));
}
export function useAccessTokensTab({ permissions = [], params = {} }: TabViewProps, _optional = {}) {
  const ports = useSecurityPorts({}); const t = useSecurityTranslation({}); const host = useSecurityCredentialsHost({}); const key = permissions.join('\0'); const canRead = permissions.includes('security.read');
  const access = useController({ create: () => createAccessTokensController({ api: ports.securityApi, permissions }, hostOptions({ host })), dependencies: [ports.securityApi, key, host.refreshSignal, host.describeError] }, { start: ({ controller }) => { void controller.load({}); } });
  const other = useController({ create: () => createOtherCredentialsController({ api: ports.otherCredentials ?? noOtherCredentials, permissions }, hostOptions({ host })), dependencies: [ports.otherCredentials, key, host.refreshSignal, host.describeError] }, { start: ({ controller }) => { void controller.load({}); } });
  const [removal, setRemoval] = useState<Removal | null>(null);
  const s = access.snapshot, o = other.snapshot; const { query, category } = currentFilter({ snapshot: s });
  const scope: RowScope = { permissions, query, category, setRemoval };
  const rows = withKeyFacts({ rows: accessRows({ snapshot: s, controller: access.controller, scope }), snapshot: s, controller: access.controller, t, canAttach: Boolean(ports.securityApi.useProjectKey) });
  const providers = providerOptions({ snapshot: s, controller: access.controller, scope });
  const groups = credentialGroups({ snapshot: s, rows, controller: access.controller, scope }); const counts = tokenCounts({ access: s, other: o, query });
  const otherPart = otherView({ snapshot: o, controller: other.controller, scope, host: { t, links: host.otherStores ?? {} }, removal });
  const reload = () => { void access.controller?.load({}); void other.controller?.load({}); };
  return { denied: !canRead, ...tabStatus({ access: s, other: o }), rows, ...otherPart, sections: credentialSections({ groups, otherRows: otherPart.otherRows }), providers, groups, hostingEmpty: hostingEmpty({ snapshot: s, groups, query, category }), categories: CATEGORIES, query, category, ...counts, countText: credentialCountText({ total: counts.total, matched: counts.matched, query }, { t }), removal,
    accessRemoval: accessRemovalView({ removal, snapshot: s, t }),
    draft: s?.draft ?? null, errors: errorList({ access: s, other: o, t }), executionMode: s?.executionMode ?? null,
    t, canAddCustom: permissions.includes('custom-credentials.write'),
    addCustom() { access.controller?.begin({ kind: 'custom' }); },
    onQuery({ value }: { value: string }) { access.controller?.filter({ query: value }); },
    onCategory({ value }: { value: string }) { access.controller?.filter({ category: value as CredentialCategory | 'all' }); },
    reload, pluginsHref: typeof params.pluginsHref === 'string' ? params.pluginsHref : null,
    sharedKeys: sharedKeysEntry({ api: ports.securityApi, permissions, t, onGranted: reload }),
    cancelRemove() { if (!s?.saving && !o?.saving) setRemoval(null); },
    async confirmRemove() { if (!removal) return;
      const ok = removal.type === 'access' ? await access.controller?.remove({ row: removal.row as CredentialSummary }) : await other.controller?.remove({ row: removal.row as OtherCredentialSummary }); if (!ok) throw new Error('Unable to remove credential');
      setRemoval(null); },
    controller: access.controller,
  };
}
