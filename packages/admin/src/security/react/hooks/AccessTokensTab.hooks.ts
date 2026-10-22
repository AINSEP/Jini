import { useState } from 'react';
import { useController } from '../../../core/react/use-controller.js';
import type { TabViewProps } from '../../../core/react/bind-react.js';
import { createAccessTokensController } from '../../controllers/access-tokens.controller.js';
import { createOtherCredentialsController } from '../../controllers/other-credentials.controller.js';
import type { CredentialSummary, OtherCredentialSummary, CredentialCategory } from '../../models.js';
import { CATEGORIES, credentialLabel, filterCredentials, filterOtherCredentials, otherWritePermission, writePermission } from '../../rules.js';
import { noOtherCredentials, useSecurityPorts } from './SecurityPorts.hooks.js';
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
  return filterCredentials({ rows: s.rows, providers: s.providers, query, category }).map(row => ({ row, label: credentialLabel({ row, providers: s.providers }), canWrite: permissions.includes(writePermission({ kind: row.kind })), edit() { controller?.begin({ row }); }, remove() { setRemoval({ row, type: 'access' }); }, makeDefault() { void controller?.makeDefault({ row }); } }));
}
function otherRowsView({ snapshot: o, controller, scope }: { snapshot: OtherSnapshot | null; controller: OtherController | null; scope: RowScope }, _optional = {}) {
  if (!o) return [];
  const { permissions, query, category, setRemoval } = scope;
  return filterOtherCredentials({ rows: o.rows, query, category }).map(row => ({ row, canWrite: permissions.includes(otherWritePermission({ store: row.store })), token: o.drafts[`${row.store}:${row.id}`] ?? '', onToken({ value }: { value: string }) { controller?.setDraft({ key: `${row.store}:${row.id}`, token: value }); }, replace() { void controller?.replace({ row }); }, remove() { setRemoval({ row, type: 'other' }); } }));
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
function errorList({ access: s, other: o }: { access: AccessSnapshot | null; other: OtherSnapshot | null }, _optional = {}) {
  return [...(s?.error ? [s.error] : []), ...Object.values(s?.errors ?? {}), ...Object.values(o?.errors ?? {})];
}
export function useAccessTokensTab({ permissions = [] }: TabViewProps, _optional = {}) {
  const ports = useSecurityPorts({}); const key = permissions.join('\0'); const canRead = permissions.includes('security.read');
  const access = useController({ create: () => createAccessTokensController({ api: ports.securityApi, permissions }), dependencies: [ports.securityApi, key] }, { start: ({ controller }) => { void controller.load({}); } });
  const other = useController({ create: () => createOtherCredentialsController({ api: ports.otherCredentials ?? noOtherCredentials, permissions }), dependencies: [ports.otherCredentials, key] }, { start: ({ controller }) => { void controller.load({}); } });
  const [removal, setRemoval] = useState<Removal | null>(null);
  const s = access.snapshot, o = other.snapshot; const { query, category } = currentFilter({ snapshot: s });
  const scope: RowScope = { permissions, query, category, setRemoval };
  const rows = accessRows({ snapshot: s, controller: access.controller, scope });
  const otherRows = otherRowsView({ snapshot: o, controller: other.controller, scope });
  const providers = providerOptions({ snapshot: s, controller: access.controller, scope });
  return { denied: !canRead, ...tabStatus({ access: s, other: o }), rows, otherRows, providers, categories: CATEGORIES, query, category, ...tokenCounts({ access: s, other: o, query }), removal,
    draft: s?.draft ?? null, errors: errorList({ access: s, other: o }),
    canAddCustom: permissions.includes('custom-credentials.write'),
    addCustom() { access.controller?.begin({ kind: 'custom' }); },
    onQuery({ value }: { value: string }) { access.controller?.filter({ query: value }); },
    onCategory({ value }: { value: string }) { access.controller?.filter({ category: value as CredentialCategory | 'all' }); },
    reload() { void access.controller?.load({}); void other.controller?.load({}); },
    cancelRemove() { if (!s?.saving && !o?.saving) setRemoval(null); },
    async confirmRemove() { if (!removal) return; const ok = removal.type === 'access' ? await access.controller?.remove({ row: removal.row as CredentialSummary }) : await other.controller?.remove({ row: removal.row as OtherCredentialSummary }); if (!ok) throw new Error('Unable to remove credential'); setRemoval(null); },
    controller: access.controller,
  };
}
