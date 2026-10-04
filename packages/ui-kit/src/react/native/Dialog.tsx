import { forwardRef } from 'react';
import type { DialogProps, ConfirmViewProps } from '../types.js';
import { useNativeDialog, useNativeConfirm } from './Dialog.hooks.js';
import { Button } from '../facade.js';
export const NativeDialog = forwardRef<HTMLDialogElement, DialogProps>(function NativeDialog(props, ref) {
  const vm = useNativeDialog({ ...props, ref });
  return <dialog {...vm.props}><h2 className="jini-dialog-title" id={vm.titleId} data-jini-part="kit.dialog-title">{vm.title}</h2>{vm.children}<Button {...vm.closeProps}>{vm.closeLabel}</Button></dialog>;
});
export function NativeConfirmDialog(props: ConfirmViewProps, _optional: Record<string, never> = {}) {
  const vm = useNativeConfirm(props);
  return <dialog {...vm.props}>
    <h2 className="jini-confirm-dialog-title" {...vm.controller.titleAttrs}>{vm.controller.title}</h2>
    <div className="jini-confirm-dialog-body" data-jini-part="confirm.body">{vm.controller.body}<p className="jini-confirm-dialog-consequence" {...vm.controller.consequenceAttrs}>{vm.controller.consequence}</p>{vm.controller.error}</div>
    <div className="jini-confirm-dialog-actions" data-jini-part="confirm.actions"><vm.Button {...vm.controller.cancel} /><vm.Button {...vm.controller.confirm} /></div>
  </dialog>;
}
