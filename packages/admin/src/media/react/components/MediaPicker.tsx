import { MediaDialog } from './MediaDialog.js';
import { Button, IconButton, TextField } from '@jini-ai/ui-kit/react';
import { useMediaPicker } from '../hooks/MediaPicker.hooks.js';
import type { MediaPickerProps } from '../hooks/MediaPicker.hooks.js';
import { MediaGrid } from './MediaGrid.js';
export function MediaPicker(props: MediaPickerProps, _optional: Record<string, never> = {}) {
  const vm = useMediaPicker(props);
  return (
    <MediaDialog className="jini-media-picker-dialog"
      attrs={{ 'data-jini-part': 'media.picker' }}
      title="Choose media"
      open
      onClose={vm.onClose}
    >
      <TextField
        attrs={{ 'data-jini-part': 'media.picker.search' }}
        label="Search media"
        value={vm.search}
        onValueChange={vm.onSearch}
      />
      {vm.snapshot?.error && <div className="jini-notice jini-notice-error"><p className="jini-notice-text" role="alert">{vm.snapshot.error}</p><Button onPress={vm.onRetry}>Retry</Button></div>}
      {vm.loading ? (
        <p className="jini-notice" role="status">Loading media…</p>
      ) : (
        <MediaGrid actions={vm.actions} api={vm.api} />
      )}
      {/* Back (left) and Cancel (right) share one footer row; both return to whatever opened the
          picker without choosing. */}
      <div className="jini-media-picker-footer" data-jini-part="media.picker.footer">
        <IconButton
          className="jini-media-picker-back"
          label="Back"
          attrs={{ 'data-jini-part': 'media.picker.back' }}
          onPress={vm.onClose}
        >
          ←
        </IconButton>
        <Button
          attrs={{ 'data-jini-part': 'media.picker.cancel', 'data-jini-autofocus': true }}
          onPress={vm.onClose}
        >
          Cancel
        </Button>
      </div>
    </MediaDialog>
  );
}
