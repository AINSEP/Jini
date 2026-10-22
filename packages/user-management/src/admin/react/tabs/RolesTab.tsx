import { Button, TextField, Notice } from '@jini-ai/ui-kit/react';
import { useRolesTab } from '../hooks/RolesTab.hooks.js';
import { RoleRow } from '../components/RoleRow.js';
export default function RolesTab(_props: {
    readonly params?: Readonly<Record<string, unknown>>;
}, _optional: Record<string, never> = {}) {
    const v = useRolesTab({});
    return <section><h2>Roles</h2>
    {v.canManage ? <form onSubmit={v.submit}>{v.error ? <Notice tone="danger">{v.error}</Notice> : null}
      <TextField label="Role name" value={v.name} onValueChange={v.changeName} required/>
      <Button type="submit" pending={v.saving} disabled={v.createDisabled}>Create role</Button>
    </form> : null}
    {v.rows.length ? <table><thead><tr><th>Name</th><th>Type</th><th>More</th></tr></thead>
      <tbody>{v.rows.map(role => <RoleRow key={role.id} role={role}/>)}</tbody></table> : <p>No roles yet.</p>}
  </section>;
}
