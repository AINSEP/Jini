import { ConfirmDialog } from '@jini-ai/ui-kit/react';
import { useMediaPurgeDialog } from '../hooks/MediaPurgeDialog.hooks.js';
import type { MediaPurgeDialogProps } from '../hooks/MediaPurgeDialog.hooks.js';
/** Views are overridable; ui-kit owns cancel-first focus and pending/agent guards. */
export function MediaPurgeDialog(props: MediaPurgeDialogProps, _optional: Record<string, never> = {}) {
  const vm = useMediaPurgeDialog(props);
  return <ConfirmDialog open={props.open} pending={props.pending} title="Delete permanently?"
    agentHandle="media-purge" confirmLabel="Delete permanently" tone="danger" agentMayConfirm={false}
    consequence={vm.consequence}
    actionAccessibleNames={vm.actionAccessibleNames}
    attrs={{ 'data-jini-part': 'media.purge', 'data-agent-element': 'media-purge' }}
    onCancel={props.onCancel} onConfirm={props.onConfirm} />;
}
