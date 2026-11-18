import type { ConfirmDialogProps } from '../types.js';
import { useConfirmFacade } from './ConfirmDialog.hooks.js';
import { Overlay } from '../KitProvider.js';
export function ConfirmDialog({ useConfirmFacadeHook = useConfirmFacade, ...props }: ConfirmDialogProps & { useConfirmFacadeHook?: typeof useConfirmFacade }, _optional: Record<string, never> = {}) {
  const vm = useConfirmFacadeHook(props);
  return <Overlay container={vm.controller.overlayContainer}><span ref={vm.controller.boundaryRef} className="jini-overlay-boundary">
    <vm.Component controller={vm.controller} />
  </span></Overlay>;
}
