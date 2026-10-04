import { MediaDialog } from './MediaDialog.js';
import { Button, TextField } from '@jini-ai/ui-kit/react';
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
      <Button
        attrs={{ 'data-jini-part': 'media.picker.cancel', 'data-jini-autofocus': true }}
        onPress={vm.onClose}
      >
        Cancel
      </Button>
    </MediaDialog>
  );
}
