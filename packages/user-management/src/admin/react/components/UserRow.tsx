import { Button, Badge, Menu, TextField, Select, Notice } from '@jini-ai/ui-kit/react';
import type { AdminOperator } from '../../models.js';
import { useUserRow } from '../hooks/UsersTab.hooks.js';
export function UserRow({ user }: { user: AdminOperator }, _optional: Record<string, never> = {}) {
  const v = useUserRow({ user });
  return <><tr><td>{v.canExpand ? <Button onPress={v.toggle} attrs={{ 'aria-expanded': v.expanded }}>{user.username}</Button> : user.username}</td><td>{user.email ?? '—'}</td>
    <td><Badge>{user.status}</Badge></td><td>{v.roles}</td><td>{v.policies}</td><td>{v.items.length ? <Menu label={v.menuLabel} items={v.items} disabled={v.s.confirming || v.s.rowSavingId !== null}/> : null}</td></tr>
    {v.expanded ? <tr><td colSpan={6}>
      {v.s.grantError ? <Notice tone="danger">{v.s.grantError}</Notice> : null}
      {v.canEmail ? <><TextField label="Email" type="email" value={v.s.editEmail} onValueChange={v.email}/><Button onPress={v.saveEmail} pending={v.s.grantSaving}>Save email</Button></> : null}
      {v.canGrants ? <><Select label="Assign role" value={v.s.pendingRoleId} onValueChange={v.role} options={v.roleOptions}/><Button onPress={v.assignRole} disabled={!v.s.pendingRoleId} pending={v.s.grantSaving}>Assign</Button>
      <Select label="Attach policy" value={v.s.pendingPolicyId} onValueChange={v.policy} options={v.policyOptions}/><Button onPress={v.attachPolicy} disabled={!v.s.pendingPolicyId} pending={v.s.grantSaving}>Attach</Button></> : null}
    </td></tr> : null}</>;
}
