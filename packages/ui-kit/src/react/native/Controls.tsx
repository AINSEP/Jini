import { forwardRef } from 'react';
import type { ButtonProps, IconButtonProps, TextFieldProps, TextAreaProps, SelectProps, CheckboxProps, SwitchProps, ToastProps, NoticeProps, SpinnerProps, BadgeProps } from '../types.js';
import { useNativeButton, useNativeIconButton, useNativeTextField, useNativeTextArea, useNativeSelect, useNativeCheckbox, useNativeToast, useNativeNotice, useNativeSpinner, useNativeBadge } from './Controls.hooks.js';
// React's forwardRef callback is the framework-mandated positional exception; exported factories use two objects.
export const NativeButton = forwardRef<HTMLButtonElement, ButtonProps & { useNativeButtonHook?: typeof useNativeButton }>(function NativeButton({ useNativeButtonHook = useNativeButton, ...props }, ref) {
  const vm = useNativeButtonHook({ ...props, ref });
  return <button {...vm.props}>{vm.children}</button>;
});
export const NativeIconButton = forwardRef<HTMLButtonElement, IconButtonProps & { useNativeIconButtonHook?: typeof useNativeIconButton }>(function NativeIconButton({ useNativeIconButtonHook = useNativeIconButton, ...props }, ref) {
  const vm = useNativeIconButtonHook({ ...props, ref });
  return <button {...vm.props}>{vm.children}</button>;
});
export const NativeTextField = forwardRef<HTMLInputElement, TextFieldProps & { useNativeTextFieldHook?: typeof useNativeTextField }>(function NativeTextField({ useNativeTextFieldHook = useNativeTextField, ...props }, ref) {
  const vm = useNativeTextFieldHook({ ...props, ref });
  const field = <label htmlFor={vm.id} {...vm.labelAttrs}><span className="jini-field-label">{vm.label}</span><input {...vm.props} /></label>;
  // The eye toggle sits OUTSIDE the label (its name would otherwise join the input's accessible name),
  // in one wrapper with it so a host can pin it inside the input's right edge.
  return vm.toggle ? <span className="jini-secret">{field}<button {...vm.toggle} /></span> : field;
});
export const NativeTextArea = forwardRef<HTMLTextAreaElement, TextAreaProps & { useNativeTextAreaHook?: typeof useNativeTextArea }>(function NativeTextArea({ useNativeTextAreaHook = useNativeTextArea, ...props }, ref) {
  const vm = useNativeTextAreaHook({ ...props, ref });
  return <label htmlFor={vm.id} {...vm.labelAttrs}><span className="jini-field-label">{vm.label}</span><textarea {...vm.props} /></label>;
});
export const NativeSelect = forwardRef<HTMLSelectElement, SelectProps & { useNativeSelectHook?: typeof useNativeSelect }>(function NativeSelect({ useNativeSelectHook = useNativeSelect, ...props }, ref) {
  const vm = useNativeSelectHook({ ...props, ref });
  return <label htmlFor={vm.id} {...vm.labelAttrs}><span className="jini-field-label">{vm.label}</span><select {...vm.props}>{vm.options}</select></label>;
});
export const NativeCheckbox = forwardRef<HTMLInputElement, CheckboxProps & { useNativeCheckboxHook?: typeof useNativeCheckbox }>(function NativeCheckbox({ useNativeCheckboxHook = useNativeCheckbox, ...props }, ref) {
  const vm = useNativeCheckboxHook({ ...props, ref });
  return <label className="jini-checkbox-field" htmlFor={vm.id}><input {...vm.props} />{vm.label}</label>;
});
export const NativeSwitch = forwardRef<HTMLInputElement, SwitchProps & { useNativeCheckboxHook?: typeof useNativeCheckbox }>(function NativeSwitch({ useNativeCheckboxHook = useNativeCheckbox, ...props }, ref) {
  const vm = useNativeCheckboxHook({ ...props, ref }, { role: 'switch' });
  return <label className="jini-checkbox-field" htmlFor={vm.id}><input {...vm.props} />{vm.label}</label>;
});
export function NativeToast({ useNativeToastHook = useNativeToast, ...props }: ToastProps & { useNativeToastHook?: typeof useNativeToast }) {
  const vm = useNativeToastHook(props);
  return <div {...vm.props}>{vm.message}{vm.dismiss}</div>;
}
export function NativeNotice({ useNativeNoticeHook = useNativeNotice, ...props }: NoticeProps & { useNativeNoticeHook?: typeof useNativeNotice }) {
  const vm = useNativeNoticeHook(props);
  return <div {...vm.props}>{vm.children}</div>;
}
export function NativeSpinner({ useNativeSpinnerHook = useNativeSpinner, ...props }: SpinnerProps & { useNativeSpinnerHook?: typeof useNativeSpinner }) {
  const vm = useNativeSpinnerHook(props);
  return <span {...vm.props}>◌</span>;
}
export function NativeBadge({ useNativeBadgeHook = useNativeBadge, ...props }: BadgeProps & { useNativeBadgeHook?: typeof useNativeBadge }) {
  const vm = useNativeBadgeHook(props);
  return <span {...vm.props}>{vm.children}</span>;
}
