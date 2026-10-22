import { MediaDialog } from './MediaDialog.js';
import { Button, TextField } from '@jini-ai/ui-kit/react';
import { useEditMediaPanel } from '../hooks/EditMediaPanel.hooks.js';
import type { EditMediaPanelProps } from '../hooks/EditMediaPanel.hooks.js';
import { UploadButton } from './UploadButton.js';
export function EditMediaPanel(props: EditMediaPanelProps, _optional: Record<string, never> = {}) {
  const vm = useEditMediaPanel(props);
  return (
    <MediaDialog className="jini-media-edit-dialog" attrs={{ 'data-jini-part': 'media.editor', 'data-agent-element': 'media-edit-dialog' }}
      title={vm.title} open onClose={vm.close} pending={vm.saving}>
      <section className="jini-media-edit-modal-body" data-agent-element="media-edit-panel">
        <div className="jini-field-group">{vm.fieldRows.map(row => <div className={row.className} key={row.id}>{row.fields.map(field => <TextField key={field.fieldId} {...field} disabled={vm.saving} />)}</div>)}</div>
        {vm.hint && <p className="jini-field-error" role="status">{vm.hint}</p>}
        {vm.copies.map(row => <div className="jini-field" key={row.id} data-jini-part="media.editor.reference">
          <span className="jini-field-label">{row.label}</span><div className="jini-field-readonly-row">{row.isLink ? <a className="jini-field-mono jini-field-readonly" href={row.value} target="_blank" rel="noreferrer">{row.value}</a> : <code className="jini-field-mono jini-field-readonly">{row.value}</code>}
          <Button variant="ghost" attrs={row.attrs} onPress={row.copy}>{row.buttonLabel}</Button></div>
        </div>)}
        {/* Replace is an owner-requested capability legacy never had, so it sits last,
            below the legacy fields, and omits the alt input replacement never sends. */}
        {vm.canReplace && <div className="jini-media-replace-controls" data-jini-part="media.editor.replace"><UploadButton multiple={false} label="Replace file" upload={vm.replace} withAlt={false} disabled={vm.saving} /></div>}
        {vm.snapshot?.error && <p className="jini-save-error" role="alert">{vm.snapshot.error}</p>}
        <div className="jini-editor-actions" data-jini-part="media.actions">
        <Button attrs={{ 'data-jini-part': 'media.editor.save', 'data-agent-element': 'media-edit-save' }} onPress={vm.onSave} pending={vm.saving}>Save</Button>
        <Button variant="secondary" attrs={{ 'data-jini-part': 'media.editor.cancel', 'data-agent-element': 'media-edit-cancel' }} onPress={vm.close} disabled={vm.saving}>Cancel</Button>
        </div>
      </section>
    </MediaDialog>
  );
}
