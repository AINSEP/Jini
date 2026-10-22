import { Button, TextField, Notice } from '@jini-ai/ui-kit/react';
import { useUsersTab, newPasswordAttrs } from '../hooks/UsersTab.hooks.js';
import { UserRow } from '../components/UserRow.js';
export default function UsersTab(_props: { readonly params?: Readonly<Record<string, unknown>> } = {}, _optional: Record<string, never> = {}) {
  const v = useUsersTab({});
  return <section aria-label="Users">
    {v.canCreate ? <Button onPress={v.toggleForm}>New user</Button> : null}
    {v.canCreate && v.s.formOpen ? <form onSubmit={v.submit}>
      <TextField label="Username" value={v.s.username} onValueChange={v.username} required/>
      <TextField label="Email (optional)" type="email" value={v.s.email} onValueChange={v.email}/>
      <TextField label="Password" type="password" attrs={newPasswordAttrs} value={v.s.password} onValueChange={v.password} required/>
      {v.s.formError ? <Notice tone="danger">{v.s.formError}</Notice> : null}
      <Button type="submit" pending={v.s.saving}>Create user</Button><Button onPress={v.cancelForm}>Cancel</Button>
    </form> : null}
    {v.s.users?.length === 0 ? <Notice>No users yet. Create your first operator account to get started.</Notice> : <table><thead><tr><th>Username</th><th>Email</th><th>Status</th><th>Roles</th><th>Policies</th><th>Actions</th></tr></thead>
    <tbody>{v.s.users?.map(user => <UserRow key={user.principalId} user={user}/>)}</tbody></table>}
  </section>;
}
