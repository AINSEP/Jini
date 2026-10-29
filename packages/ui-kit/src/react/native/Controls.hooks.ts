import { createElement, useId, useState } from 'react';
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
/** Eye / eye-off glyphs, decorative: the button's aria-label carries the meaning. */
const EYE_PATHS = ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z'];
const EYE_OFF_PATHS = ['M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a17.8 17.8 0 0 1-2.16 3.19M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M14.12 14.12a3 3 0 1 1-4.24-4.24', 'M2 2l20 20'];
export function eyeIcon(required: { revealed: boolean }, _optional: Record<string, never> = {}) {
  const paths = (required.revealed ? EYE_OFF_PATHS : EYE_PATHS).map(d => createElement('path', { key: d, d }));
  return createElement('svg', { 'aria-hidden': true, focusable: 'false', viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }, paths);
}
/**
 * The show/hide state of a password field. Starts hidden, and re-hides when the value is cleared
 * — the usual sign a save succeeded — so a revealed secret never outlives its submit.
 * @complexity O(1).
 */
function useSecretReveal(required: TextFieldProps, _optional: Record<string, never> = {}) {
  const [revealed, setRevealed] = useState(false);
  const [lastValue, setLastValue] = useState(required.value);
  // Re-hide on the transition to empty only: an empty field may be revealed before typing.
  if (required.value !== lastValue) {
    setLastValue(required.value);
    if (required.value === '') setRevealed(false);
  }
  if (required.type !== 'password') return { type: required.type ?? 'text', toggle: null };
  // The name flips Show/Hide; no `aria-pressed` on top, or screen readers hear the state twice.
  const labels = required.secretToggleLabels ?? { show: `Show ${required.label}`, hide: `Hide ${required.label}` };
  return { type: revealed ? 'text' : 'password', toggle: { 'data-jini-part': 'kit.secret-toggle', className: 'jini-secret-toggle', type: 'button' as const,
    'aria-label': revealed ? labels.hide : labels.show, disabled: required.disabled,
    onClick: () => setRevealed(shown => !shown), children: eyeIcon({ revealed }) } };
}
export function useNativeTextField(required: TextFieldProps, _optional: Record<string, never> = {}) {
  const vm = useField(required);
  const reveal = useSecretReveal(required);
  return { ...vm, toggle: reveal.toggle, props: { ...vm.props, id: vm.id, ref: required.ref, type: reveal.type, value: required.value,
    // Off on a secret: once revealed as type="text", enhanced spellcheck would send it to a cloud service.
    spellCheck: reveal.toggle ? false : undefined,
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
