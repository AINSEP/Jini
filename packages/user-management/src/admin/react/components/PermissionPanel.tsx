import { Button, TextField, Spinner } from '@jini-ai/ui-kit/react';
import type { PolicyRecord } from '../../models.js';
import { usePermissionPanel } from '../hooks/PermissionPanel.hooks.js';
export function PermissionPanel(props: {
    policy: PolicyRecord;
}, _optional: Record<string, never> = {}) {
    const v = usePermissionPanel(props);
    return <div><h3>Current permissions</h3>
    {v.loading ? <Spinner label="Loading permissions…"/> : v.empty ? <p>No permissions yet.</p> :
            <ul>{v.rows.map(row => <li key={row.id}><code>{row.permission}</code>{row.resourceType ? <span> ({row.resourceType})</span> : null}
        {v.editable ? <Button onPress={row.requestRemove} pending={row.pending} attrs={{ 'aria-label': row.removeLabel }}>Remove</Button> : null}</li>)}</ul>}
    {v.editable ? <form onSubmit={v.submit}><TextField label="Permission" value={v.permission} onValueChange={v.changePermission} placeholder="e.g. content.write"/>
      <TextField label="Resource type (optional)" value={v.resourceType} onValueChange={v.changeResourceType}/>
      <Button type="submit" pending={v.pending} disabled={v.addDisabled}>Add</Button></form> : null}
  </div>;
}
