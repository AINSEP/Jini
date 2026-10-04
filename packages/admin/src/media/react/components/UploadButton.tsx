import { Button, TextField } from '@jini-ai/ui-kit/react';
import { useUploadButton } from '../hooks/UploadButton.hooks.js';
import type { UploadButtonProps } from '../hooks/UploadButton.hooks.js';
export function UploadButton(props: UploadButtonProps, _optional: Record<string, never> = {}) {
  const vm = useUploadButton(props);
  return (
    <div className="jini-toolbar jini-media-upload" data-jini-part="media.upload" data-agent-element={vm.handles.toolbar} onDragOver={vm.onDragOver} onDrop={vm.onDrop}>
      <Button variant="secondary" onPress={vm.onPress} disabled={vm.disabled}>{vm.chooseLabel}</Button>
      <span className="jini-media-upload-filename" aria-live="polite">{vm.selectedFileName}</span>
      {vm.withAlt && <TextField
        attrs={{ 'data-jini-part': 'media.upload.alt', 'data-agent-element': vm.handles.alt }}
        className="jini-media-upload-alt"
        placeholder="Alt text (optional)"
        label={vm.altLabel}
        value={vm.alt}
        onValueChange={vm.setAlt}
      />}
      <input
        className="jini-media-upload-file"
        data-jini-part="media.upload.file"
        data-agent-element={vm.handles.file}
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm"
        ref={vm.inputRef}
        aria-label="File to upload"
        type="file"
        hidden
        multiple={vm.multiple}
        onChange={vm.onFile}
        disabled={vm.disabled}
      />
      <Button
        attrs={{ 'data-jini-part': 'media.upload.button', 'data-agent-element': vm.handles.submit }}
        onPress={vm.onUpload}
        disabled={vm.uploadDisabled}
      >
        {vm.label}
      </Button>
      <p className="jini-media-success" role="status" aria-live="polite" aria-atomic="true">{vm.success}</p>
      {vm.error && <p className="jini-notice jini-notice-error" role="alert">{vm.error}</p>}
    </div>
  );
}
