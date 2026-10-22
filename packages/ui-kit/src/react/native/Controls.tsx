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
  return <label htmlFor={vm.id} {...vm.labelAttrs}><span className="jini-field-label">{vm.label}</span><input {...vm.props} /></label>;
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
export function NativeToast(props: ToastProps, _optional: Record<string, never> = {}) {
  const vm = useNativeToast(props);
  return <div {...vm.props}>{vm.message}{vm.dismiss}</div>;
}
export function NativeNotice(props: NoticeProps, _optional: Record<string, never> = {}) {
  const vm = useNativeNotice(props);
  return <div {...vm.props}>{vm.children}</div>;
}
export function NativeSpinner(props: SpinnerProps, _optional: Record<string, never> = {}) {
  const vm = useNativeSpinner(props);
  return <span {...vm.props}>◌</span>;
}
export function NativeBadge(props: BadgeProps, _optional: Record<string, never> = {}) {
  const vm = useNativeBadge(props);
  return <span {...vm.props}>{vm.children}</span>;
}
