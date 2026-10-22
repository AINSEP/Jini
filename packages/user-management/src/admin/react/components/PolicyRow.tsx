import { Button, TextField, Menu, Badge } from '@jini-ai/ui-kit/react';
import type { PolicyRecord } from '../../models.js';
import { usePolicyRow } from '../hooks/PoliciesTab.hooks.js';
import { PermissionPanel } from './PermissionPanel.js';
export function PolicyRow(props: {
    policy: PolicyRecord;
}, _optional: Record<string, never> = {}) {
    const v = usePolicyRow(props);
    return <><tr><td>{v.editing ? <TextField label="Policy new name" value={v.draft} onValueChange={v.changeName}/> : v.name}</td>
    <td>{v.editing ? <TextField label="Policy new description" value={v.draftDescription} onValueChange={v.changeDescription}/> : v.description}</td>
    <td><Badge>{v.type}</Badge></td><td>{v.editable ?
            v.editing ? <><Button onPress={v.save} pending={v.pending} disabled={v.saveDisabled}>Save</Button><Button onPress={v.cancel}>Cancel</Button></> :
                <Menu label={v.menuLabel} items={v.menu}/> : <Button onPress={v.viewPermissions}>{v.readLabel}</Button>}</td></tr>
    {v.open ? <tr><td colSpan={4}><PermissionPanel policy={props.policy}/></td></tr> : null}</>;
}
