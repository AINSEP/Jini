import { Dialog } from '../../../react/kit.js';
import { useMediaDialog } from '../hooks/MediaDialog.hooks.js';
import type { MediaDialogProps } from '../hooks/MediaDialog.hooks.js';
export function MediaDialog({ useMediaDialogHook = useMediaDialog, ...props }: MediaDialogProps & { useMediaDialogHook?: typeof useMediaDialog }) {
  const vm = useMediaDialogHook(props);
  return vm.open ? <Dialog {...vm.dialogProps} /> : null;
}
