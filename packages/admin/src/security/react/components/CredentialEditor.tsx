import { Button, TextField, TextArea, Select, Dialog } from '@jini-ai/ui-kit/react';
import { useCredentialEditor, type CredentialEditorProps } from '../hooks/CredentialEditor.hooks.js';
export function CredentialEditor(props: CredentialEditorProps, _optional = {}) {
  const vm = useCredentialEditor(props);
  return <Dialog open title={vm.title} onClose={vm.cancel} pending={vm.saving}>
    <TextField label="Name" value={props.draft.label} onValueChange={vm.onLabel} disabled={vm.saving} />
    <TextField label={vm.tokenLabel} type="password" value={props.draft.token} onValueChange={vm.onToken} disabled={vm.saving} attrs={{ 'data-agent-private': 'true' }} />
    {vm.fields.map(field => <TextField key={field.name} label={field.label} type={field.secret ? 'password' : 'text'} value={field.value} onValueChange={field.onValueChange} required={field.required === true} disabled={vm.saving} />)}
    {props.draft.kind === 'custom' && <><Select label="Category" value={props.draft.category} options={vm.categories} onValueChange={vm.onCategory} disabled={vm.saving} /><TextField label="Base URL" type="url" value={props.draft.baseUrl} onValueChange={vm.onUrl} disabled={vm.saving} /><TextField label="Username" value={props.draft.username} onValueChange={vm.onUsername} disabled={vm.saving} /><TextArea label="Additional hosts" value={props.draft.additionalHosts} onValueChange={vm.onHosts} disabled={vm.saving} /></>}
    <Button onPress={vm.save} pending={vm.saving}>Save</Button><Button onPress={vm.cancel} disabled={vm.saving}>Cancel</Button>
  </Dialog>;
}
