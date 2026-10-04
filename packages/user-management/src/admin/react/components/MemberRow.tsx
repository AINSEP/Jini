import { Badge, Button, Menu, Notice, Spinner } from '@jini-ai/ui-kit/react';
import type { AdminMember } from '../../models.js';
import { useMemberRow } from '../hooks/MembersPage.hooks.js';
export function MemberRow({ member }: { member: AdminMember }, _optional: Record<string, never> = {}) {
  const v = useMemberRow({ member });
  return <><tr><td><Button onPress={v.toggle} attrs={{ 'aria-expanded': v.expanded }}>{member.email}</Button></td><td>{member.name ?? '—'}</td><td><Badge>{member.status}</Badge></td><td>{v.created}</td>
    <td>{v.items.length ? <Menu label={v.menuLabel} items={v.items}/> : null}{v.rs.error ? <Notice tone="danger">{v.rs.error}</Notice> : null}{v.rs.notice ? <Notice>{v.rs.notice}</Notice> : null}</td></tr>
    {v.expanded ? <tr><td colSpan={5}>{v.loading ? <Spinner label="Loading detail…"/> : v.s.detailError ? <Notice tone="danger">{v.s.detailError}</Notice> : v.detail ? <dl><dt>ID</dt><dd>{v.detail.id}</dd><dt>Email verified</dt><dd>{v.verified}</dd><dt>Updated</dt><dd>{v.detail.updatedAt}</dd><dt>Version</dt><dd>{v.detail.version}</dd></dl> : null}</td></tr> : null}</>;
}
