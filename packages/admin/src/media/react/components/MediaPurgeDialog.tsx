import { ConfirmDialog } from '../../../react/kit.js';
import { useMediaPurgeDialog } from '../hooks/MediaPurgeDialog.hooks.js';
import type { MediaPurgeDialogProps } from '../hooks/MediaPurgeDialog.hooks.js';
/** Views are overridable; ui-kit owns cancel-first focus and pending/agent guards. */
export function MediaPurgeDialog({ useMediaPurgeDialogHook = useMediaPurgeDialog, ...props }: MediaPurgeDialogProps & { useMediaPurgeDialogHook?: typeof useMediaPurgeDialog }) {
  const vm = useMediaPurgeDialogHook(props);
  return <ConfirmDialog open={props.open} pending={props.pending} title="Delete permanently?"
    agentHandle="media-purge" confirmLabel="Delete permanently" tone="danger" agentMayConfirm={false}
    consequence={vm.consequence}
    actionAccessibleNames={vm.actionAccessibleNames}
    attrs={{ 'data-jini-part': 'media.purge', 'data-agent-element': 'media-purge' }}
    onCancel={props.onCancel} onConfirm={props.onConfirm} />;
}
