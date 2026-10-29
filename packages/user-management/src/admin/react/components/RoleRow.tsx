import { Button, TextField, Menu, Badge } from '@jini-ai/ui-kit/react';
import type { RoleRecord } from '../../models.js';
import { useRoleRow } from '../hooks/RolesTab.hooks.js';
export function RoleRow(props: {
    role: RoleRecord;
}, _optional: Record<string, never> = {}) {
    const v = useRoleRow(props);
    const editActions = v.editing ? <><Button onPress={v.save} pending={v.pending} disabled={v.saveDisabled}>Save</Button><Button onPress={v.cancel}>Cancel</Button></> :
        <Menu label={v.menuLabel} items={v.menu} />;
    return <tr><td>{v.editing ? <TextField label="Role new name" value={v.draft} onValueChange={v.changeName} /> : v.name}</td>
        <td><Badge>{v.type}</Badge></td><td>{v.editable ?
            editActions : <span>—</span>}</td></tr>;
}
