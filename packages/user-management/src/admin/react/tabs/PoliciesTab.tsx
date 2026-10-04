import { Button, TextField, Notice } from '@jini-ai/ui-kit/react';
import { usePoliciesTab } from '../hooks/PoliciesTab.hooks.js';
import { PolicyRow } from '../components/PolicyRow.js';
export default function PoliciesTab(_props: {
    readonly params?: Readonly<Record<string, unknown>>;
}, _optional: Record<string, never> = {}) {
    const v = usePoliciesTab({});
    return <section><h2>Policies</h2>
    {v.canManage ? <form onSubmit={v.submit}>{v.error ? <Notice tone="danger">{v.error}</Notice> : null}
      <TextField label="Policy name" value={v.name} onValueChange={v.changeName} required/>
      <TextField label="Description (optional)" value={v.description} onValueChange={v.changeDescription}/>
      <Button type="submit" pending={v.saving} disabled={v.createDisabled}>Create policy</Button>
    </form> : null}
    {v.rows.length ? <table><thead><tr><th>Name</th><th>Description</th><th>Type</th><th>More</th></tr></thead>
      <tbody>{v.rows.map(policy => <PolicyRow key={policy.id} policy={policy}/>)}</tbody></table> : <p>No policies yet.</p>}
  </section>;
}
