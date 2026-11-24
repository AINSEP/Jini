import { Button, TextField, TextArea, Select, Dialog } from '../../../react/kit.js';
import type { useCredentialEditor, CredentialEditorProps } from '../hooks/CredentialEditor.hooks.js';
import type { SecurityChipField } from './chip-field.js';
type ExtraFieldView = ReturnType<typeof useCredentialEditor>['fieldsAfter'][number];
/** The host's chip field arrives as a required slot; every hook arrives as a required input. */
export function CredentialEditor({ useCredentialEditorHook, ChipField, ...props }: CredentialEditorProps & { useCredentialEditorHook: typeof useCredentialEditor; ChipField: SecurityChipField }) {
  const vm = useCredentialEditorHook(props);
  return <Dialog open title={vm.title} onClose={vm.cancel} pending={vm.saving}>
    <TextField label="Name" value={props.draft.label} onValueChange={vm.onLabel} disabled={vm.saving} />
    {vm.rotationWarning && <p role="note">{vm.rotationWarning}</p>}{vm.storage && <p>{vm.storage}</p>}
    <ExtraFields fields={vm.fieldsBefore} saving={vm.saving} />
    <TextField label={vm.tokenLabel} type="password" value={props.draft.token} onValueChange={vm.onToken} disabled={vm.saving} attrs={{ 'data-agent-private': 'true' }} />
    <ExtraFields fields={vm.fieldsAfter} saving={vm.saving} />
    {vm.guidance && <details><summary>{vm.guidance.summary}</summary><p>{vm.guidance.text}</p></details>}
    {vm.worksFor && <ChipField {...vm.worksFor} />}
    {props.draft.kind === 'custom' && <><Select label="Category" value={props.draft.category} options={vm.categories} onValueChange={vm.onCategory} disabled={vm.saving} /><TextField label="Base URL" type="url" value={props.draft.baseUrl} onValueChange={vm.onUrl} disabled={vm.saving} /><TextField label="Username" value={props.draft.username} onValueChange={vm.onUsername} disabled={vm.saving} /><TextArea label="Additional hosts" value={props.draft.additionalHosts} onValueChange={vm.onHosts} disabled={vm.saving} /></>}
    {vm.hostsError && <p role="alert">{vm.hostsError}</p>}
    <Button onPress={vm.save} pending={vm.saving} disabled={!vm.canSave}>Save</Button><Button onPress={vm.cancel} disabled={vm.saving}>Cancel</Button>
  </Dialog>;
}
/** A provider's extra fields; a secret one is masked and private to agents like the token itself, and its help sits below it. */
function ExtraFields({ fields, saving }: { fields: readonly ExtraFieldView[]; saving: boolean }) {
  return <>{fields.map(field => <div key={field.name}><TextField label={field.label} type={field.secret ? 'password' : 'text'} value={field.value} onValueChange={field.onValueChange} required={field.required === true} disabled={saving} {...(field.secret ? { attrs: { 'data-agent-private': 'true' } } : {})} />
    {field.help && <p>{field.help}</p>}</div>)}</>;
}
