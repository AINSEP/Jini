import { createElement, useId } from 'react';
import type { ChangeEvent } from 'react';
import type { BaseProps, ButtonProps, IconButtonProps, TextFieldProps, TextAreaProps, SelectProps, CheckboxProps, ToastProps, NoticeProps, SpinnerProps, BadgeProps } from '../types.js';
export function useNativeButton(required: ButtonProps, _optional: Record<string, never> = {}) {
  return { children: required.children, props: { 'data-jini-part': 'kit.button', ref: required.ref, className: `jini-btn jini-btn-${required.variant ?? 'primary'} ${required.className ?? ''}`.trim(),
    type: required.type ?? 'button', disabled: !!required.disabled || !!required.pending,
    'aria-busy': required.pending, 'data-jini-variant': required.variant ?? 'primary',
    'data-jini-state': required.pending ? 'pending' : required.disabled ? 'disabled' : 'ready',
    onClick: () => { if (!required.disabled && !required.pending) required.onPress?.({}); },
    // Opaque metadata wins over generated metadata; behavioral props cannot be supplied through attrs.
    ...required.attrs } };
}
export function useNativeIconButton(required: IconButtonProps, _optional: Record<string, never> = {}) {
  const vm = useNativeButton(required);
  return { ...vm, props: { ...vm.props, 'data-jini-part': 'kit.icon-button', 'aria-label': required.label, ...required.attrs } };
}
function useField(required: BaseProps & { label: string; disabled?: boolean; required?: boolean }) {
  const generated = useId();
  return { id: required.attrs?.id ?? generated, label: required.label, labelAttrs: { 'data-jini-part': 'kit.field-label', className: 'jini-field' },
    props: { ...required.attrs, className: `jini-input ${required.className ?? ''}`.trim(), disabled: required.disabled, required: required.required } };
}
export function useNativeTextField(required: TextFieldProps, _optional: Record<string, never> = {}) {
  const vm = useField(required);
  return { ...vm, props: { ...vm.props, id: vm.id, ref: required.ref, type: required.type ?? 'text', value: required.value,
    placeholder: required.placeholder, onChange: (event: ChangeEvent<HTMLInputElement>) => {
      if (!required.disabled) required.onValueChange({ value: event.currentTarget.value });
    } } };
}
export function useNativeTextArea(required: TextAreaProps, _optional: Record<string, never> = {}) {
  const vm = useField(required);
  return { ...vm, props: { ...vm.props, className: `jini-textarea ${required.className ?? ''}`.trim(), id: vm.id, ref: required.ref, value: required.value, rows: required.rows ?? 3,
    placeholder: required.placeholder, onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
      if (!required.disabled) required.onValueChange({ value: event.currentTarget.value });
    } } };
}
export function useNativeSelect(required: SelectProps, _optional: Record<string, never> = {}) {
  const vm = useField(required);
  // Keep a real HTMLSelectElement: the host agent driver can set an option without library-specific knowledge.
  const options = required.options.map(option => createElement('option', { className: 'jini-select-option', key: option.value, value: option.value, disabled: option.disabled }, option.label));
  return { ...vm, options, props: { ...vm.props, className: `jini-select ${required.className ?? ''}`.trim(), id: vm.id, ref: required.ref, value: required.value,
    onChange: (event: ChangeEvent<HTMLSelectElement>) => { if (!required.disabled) required.onValueChange({ value: event.currentTarget.value }); } } };
}
export function useNativeCheckbox(required: CheckboxProps, optional: { role?: 'switch' } = {}) {
  const generated = useId();
  return { label: required.label, id: required.attrs?.id ?? generated,
    props: { ...required.attrs, id: required.attrs?.id ?? generated, ref: required.ref, className: `jini-checkbox ${required.className ?? ''}`.trim(),
      type: 'checkbox', role: optional.role, checked: required.checked, disabled: required.disabled,
      onChange: (event: ChangeEvent<HTMLInputElement>) => { if (!required.disabled) required.onCheckedChange({ checked: event.currentTarget.checked }); } } };
}
export function useNativeToast(required: ToastProps, _optional: Record<string, never> = {}) {
  return { props: { 'data-jini-part': 'kit.toast', ...required.attrs, className: `jini-toast ${required.className ?? ''}`.trim(),
    role: required.tone === 'danger' ? 'alert' : 'status', tabIndex: -1, 'data-jini-variant': required.tone ?? 'info' },
    message: required.message, dismiss: required.onDismiss ? createElement('button', { type: 'button', className: 'jini-btn jini-btn-ghost jini-toast-dismiss', 'data-jini-part': 'kit.toast-dismiss',
      'aria-label': required.dismissLabel ?? 'Dismiss notification', onClick: () => required.onDismiss?.({}) }, '×') : null };
}
export function useNativeNotice(required: NoticeProps, _optional: Record<string, never> = {}) {
  return { children: required.children, props: { 'data-jini-part': 'kit.notice', ...required.attrs, className: `jini-notice jini-notice-${required.tone === 'danger' ? 'error' : required.tone ?? 'info'} ${required.className ?? ''}`.trim(), tabIndex: -1,
    role: required.tone === 'danger' ? 'alert' : 'status', 'data-jini-variant': required.tone ?? 'info' } };
}
export function useNativeSpinner(required: SpinnerProps, _optional: Record<string, never> = {}) {
  return { props: { 'data-jini-part': 'kit.spinner', role: 'status', 'aria-label': required.label ?? 'Loading', tabIndex: -1, ...required.attrs, className: `jini-spinner ${required.className ?? ''}`.trim() } };
}
export function useNativeBadge(required: BadgeProps, _optional: Record<string, never> = {}) {
  return { children: required.children, props: { 'data-jini-part': 'kit.badge', ...required.attrs, className: `jini-pill jini-pill-${required.tone ?? 'info'} ${required.className ?? ''}`.trim(), tabIndex: -1, 'data-jini-variant': required.tone ?? 'info' } };
}
