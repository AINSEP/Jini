import { useState } from 'react';
import { useController } from '../../../react/use-controller.js';
import type { TabViewProps } from '../../../react/bind-react.js';
import { createAccessTokensController } from '../../controllers/access-tokens.controller.js';
import { createOtherCredentialsController } from '../../controllers/other-credentials.controller.js';
import type { CredentialSummary, OtherCredentialSummary, CredentialCategory } from '../../models.js';
import { CATEGORIES, credentialLabel, filterCredentials, filterOtherCredentials, otherWritePermission, writePermission } from '../../rules.js';
import { useSecurityPorts } from './SecurityPorts.hooks.js';
export function useAccessTokensTab({ permissions = [] }: TabViewProps, _optional = {}) {
  const ports = useSecurityPorts({}); const key = permissions.join('\0'); const canRead = permissions.includes('security.read');
  const access = useController({ create: () => createAccessTokensController({ api: ports.securityApi, permissions }), dependencies: [ports.securityApi, key] }, { start: ({ controller }) => { void controller.load({}); } });
  const other = useController({ create: () => createOtherCredentialsController({ api: ports.otherCredentials ?? { async list() { return []; }, async replace() { throw new Error('Unavailable'); }, async remove() { throw new Error('Unavailable'); } }, permissions }), dependencies: [ports.otherCredentials, key] }, { start: ({ controller }) => { void controller.load({}); } });
  const [removal, setRemoval] = useState<{ row: CredentialSummary | OtherCredentialSummary; type: 'access' | 'other' } | null>(null);
  const s = access.snapshot, o = other.snapshot; const query = s?.query ?? '', category = s?.category ?? 'all';
  const rows = s ? filterCredentials({ rows: s.rows, providers: s.providers, query, category }).map(row => ({ row, label: credentialLabel({ row, providers: s.providers }), canWrite: permissions.includes(writePermission({ kind: row.kind })), edit() { access.controller?.begin({ row }); }, remove() { setRemoval({ row, type: 'access' }); }, makeDefault() { void access.controller?.makeDefault({ row }); } })) : [];
  const otherRows = o ? filterOtherCredentials({ rows: o.rows, query, category }).map(row => ({ row, canWrite: permissions.includes(otherWritePermission({ store: row.store })), token: o.drafts[`${row.store}:${row.id}`] ?? '', onToken({ value }: { value: string }) { other.controller?.setDraft({ key: `${row.store}:${row.id}`, token: value }); }, replace() { void other.controller?.replace({ row }); }, remove() { setRemoval({ row, type: 'other' }); } })) : [];
  const providers = (s?.providers ?? []).filter(p => (category === 'all' || p.category === category) && `${p.label} ${p.id}`.toLowerCase().includes(query.trim().toLowerCase())).map(provider => ({ provider, canWrite: permissions.includes(writePermission({ kind: provider.kind })), add() { access.controller?.begin({ kind: provider.kind, providerId: provider.id }); } }));
  // Count remains global across categories; the search count answers how many saved tokens this host holds.
  const total = (s?.rows.length ?? 0) + (o?.rows.length ?? 0);
  const matched = (s ? filterCredentials({ rows: s.rows, providers: s.providers, query, category: 'all' }).length : 0) + (o ? filterOtherCredentials({ rows: o.rows, query, category: 'all' }).length : 0);
  return { denied: !canRead, loading: s?.loading ?? true, saving: (s?.saving ?? false) || (o?.saving ?? false), rows, otherRows, providers, categories: CATEGORIES, query, category, total, matched, removal,
    draft: s?.draft ?? null, errors: [...(s?.error ? [s.error] : []), ...Object.values(s?.errors ?? {}), ...Object.values(o?.errors ?? {})],
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
