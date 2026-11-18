import { forwardRef } from 'react';
import type { DialogProps, ConfirmViewProps } from '../types.js';
import { useNativeDialog, useNativeConfirm } from './Dialog.hooks.js';
import { useKitContext } from '../context.js';
import { NativeButton } from './Controls.js';
/** Hooks NativeDialog calls; defaults to the real ones, a test hands in fakes. */
export const defaultNativeDialogHooks = { useKitContext, useNativeDialog };
export type NativeDialogHooks = typeof defaultNativeDialogHooks;

export const NativeDialog = forwardRef<HTMLDialogElement, DialogProps & { hooks?: NativeDialogHooks | undefined }>(function NativeDialog({ hooks = defaultNativeDialogHooks, ...props }, ref) {
  const Button = hooks.useKitContext({})?.kit.components.Button ?? NativeButton;
  const vm = hooks.useNativeDialog({ ...props, ref });
  return <dialog {...vm.props}><h2 className="jini-dialog-title" id={vm.titleId} data-jini-part="kit.dialog-title">{vm.title}</h2>{vm.children}<Button {...vm.closeProps}>{vm.closeLabel}</Button></dialog>;
});
/** Hooks NativeConfirmDialog calls; defaults to the real ones, a test hands in fakes. */
export const defaultNativeConfirmDialogHooks = { useKitContext, useNativeConfirm };
export type NativeConfirmDialogHooks = typeof defaultNativeConfirmDialogHooks;

export function NativeConfirmDialog({ hooks = defaultNativeConfirmDialogHooks, ...props }: ConfirmViewProps & { hooks?: NativeConfirmDialogHooks | undefined }, _optional: Record<string, never> = {}) {
  const Button = hooks.useKitContext({})?.kit.components.Button ?? NativeButton;
  const vm = hooks.useNativeConfirm(props, { Button });
  return <dialog {...vm.props}>
    <h2 className="jini-confirm-dialog-title" {...vm.controller.titleAttrs}>{vm.controller.title}</h2>
    <div className="jini-confirm-dialog-body" data-jini-part="confirm.body">{vm.controller.body}<p className="jini-confirm-dialog-consequence" {...vm.controller.consequenceAttrs}>{vm.controller.consequence}</p>{vm.controller.error}</div>
    <div className="jini-confirm-dialog-actions" data-jini-part="confirm.actions"><vm.Button {...vm.controller.cancel} /><vm.Button {...vm.controller.confirm} /></div>
  </dialog>;
}
