import type { ConfirmDialogProps } from '../types.js';
import { useConfirmFacade } from './ConfirmDialog.hooks.js';
import { Overlay } from '../KitProvider.js';
export function ConfirmDialog(props: ConfirmDialogProps, _optional: Record<string, never> = {}) {
  const vm = useConfirmFacade(props);
  return <Overlay container={vm.controller.overlayContainer}><span ref={vm.controller.boundaryRef} className="jini-overlay-boundary">
    <vm.Component controller={vm.controller} />
  </span></Overlay>;
}
