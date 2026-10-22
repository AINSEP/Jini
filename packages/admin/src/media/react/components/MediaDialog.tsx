import { Dialog } from '@jini-ai/ui-kit/react';
import { useMediaDialog } from '../hooks/MediaDialog.hooks.js';
import type { MediaDialogProps } from '../hooks/MediaDialog.hooks.js';
export function MediaDialog(props: MediaDialogProps, _optional: Record<string, never> = {}) {
  const vm = useMediaDialog(props);
  return vm.open ? <Dialog {...vm.dialogProps} /> : null;
}
