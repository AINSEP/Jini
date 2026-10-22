import { Button, Notice, TextField } from '@jini-ai/ui-kit/react';
import type { SourceControlRowView } from '../hooks/ProvidersTab.hooks.js';
import { useSourceControlCredentialFields } from '../hooks/SourceControlCredentialFields.hooks.js';
export function SourceControlCredentialFields({ row }: { row: SourceControlRowView }, _optional = {}) {
  const vm = useSourceControlCredentialFields({ row });
  return <><TextField label={vm.tokenLabel} type="password" value={vm.token} onValueChange={vm.onToken} disabled={vm.saving} ref={vm.tokenRef} /><p>{vm.hint}</p>{vm.hasGuidance && <details><summary>Which token do I need?</summary><p>{vm.help} {vm.tokenPageUrl && <a href={vm.tokenPageUrl} target="_blank" rel="noreferrer">Create a token</a>}</p></details>}{vm.fields.map(field => <div key={field.name}><TextField label={field.label} type={field.secret ? 'password' : 'text'} value={field.value} onValueChange={field.onValueChange} disabled={vm.saving} required={field.required} ref={field.ref} />{field.hint && <p>{field.hint}</p>}</div>)}<Button onPress={vm.save} disabled={vm.disabled} pending={vm.saving}>Save {vm.label} token</Button>{vm.error && <Notice tone="danger">{vm.error}</Notice>}</>;
}
