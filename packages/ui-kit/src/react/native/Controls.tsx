import { forwardRef } from 'react';
import type { ButtonProps, IconButtonProps, TextFieldProps, TextAreaProps, SelectProps, CheckboxProps, SwitchProps, ToastProps, NoticeProps, SpinnerProps, BadgeProps } from '../types.js';
import { useNativeButton, useNativeIconButton, useNativeTextField, useNativeTextArea, useNativeSelect, useNativeCheckbox, useNativeToast, useNativeNotice, useNativeSpinner, useNativeBadge } from './Controls.hooks.js';
// React's forwardRef callback is the framework-mandated positional exception; exported factories use two objects.
export const NativeButton = forwardRef<HTMLButtonElement, ButtonProps>(function NativeButton(props, ref) {
  const vm = useNativeButton({ ...props, ref });
  return <button {...vm.props}>{vm.children}</button>;
});
export const NativeIconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function NativeIconButton(props, ref) {
  const vm = useNativeIconButton({ ...props, ref });
  return <button {...vm.props}>{vm.children}</button>;
});
export const NativeTextField = forwardRef<HTMLInputElement, TextFieldProps>(function NativeTextField(props, ref) {
  const vm = useNativeTextField({ ...props, ref });
  const field = <label htmlFor={vm.id} {...vm.labelAttrs}><span className="jini-field-label">{vm.label}</span><input {...vm.props} /></label>;
  // The eye toggle sits OUTSIDE the label (its name would otherwise join the input's accessible name),
  // in one wrapper with it so a host can pin it inside the input's right edge.
  return vm.toggle ? <span className="jini-secret">{field}<button {...vm.toggle} /></span> : field;
});
export const NativeTextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function NativeTextArea(props, ref) {
  const vm = useNativeTextArea({ ...props, ref });
  return <label htmlFor={vm.id} {...vm.labelAttrs}><span className="jini-field-label">{vm.label}</span><textarea {...vm.props} /></label>;
});
export const NativeSelect = forwardRef<HTMLSelectElement, SelectProps>(function NativeSelect(props, ref) {
  const vm = useNativeSelect({ ...props, ref });
  return <label htmlFor={vm.id} {...vm.labelAttrs}><span className="jini-field-label">{vm.label}</span><select {...vm.props}>{vm.options}</select></label>;
});
export const NativeCheckbox = forwardRef<HTMLInputElement, CheckboxProps>(function NativeCheckbox(props, ref) {
  const vm = useNativeCheckbox({ ...props, ref });
  return <label className="jini-checkbox-field" htmlFor={vm.id}><input {...vm.props} />{vm.label}</label>;
});
export const NativeSwitch = forwardRef<HTMLInputElement, SwitchProps>(function NativeSwitch(props, ref) {
  const vm = useNativeCheckbox({ ...props, ref }, { role: 'switch' });
  return <label className="jini-checkbox-field" htmlFor={vm.id}><input {...vm.props} />{vm.label}</label>;
});
export function NativeToast({ useNativeToastHook = useNativeToast, ...props }: ToastProps & { useNativeToastHook?: typeof useNativeToast }, _optional: Record<string, never> = {}) {
  const vm = useNativeToastHook(props);
  return <div {...vm.props}>{vm.message}{vm.dismiss}</div>;
}
export function NativeNotice({ useNativeNoticeHook = useNativeNotice, ...props }: NoticeProps & { useNativeNoticeHook?: typeof useNativeNotice }, _optional: Record<string, never> = {}) {
  const vm = useNativeNoticeHook(props);
  return <div {...vm.props}>{vm.children}</div>;
}
export function NativeSpinner({ useNativeSpinnerHook = useNativeSpinner, ...props }: SpinnerProps & { useNativeSpinnerHook?: typeof useNativeSpinner }, _optional: Record<string, never> = {}) {
  const vm = useNativeSpinnerHook(props);
  return <span {...vm.props}>◌</span>;
}
export function NativeBadge({ useNativeBadgeHook = useNativeBadge, ...props }: BadgeProps & { useNativeBadgeHook?: typeof useNativeBadge }, _optional: Record<string, never> = {}) {
  const vm = useNativeBadgeHook(props);
  return <span {...vm.props}>{vm.children}</span>;
}
