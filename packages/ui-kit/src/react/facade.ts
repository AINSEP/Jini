import { createElement, forwardRef } from 'react';
import type { Attributes } from 'react';
import { useFacade, renderOverlay, useOverlayContainer } from './Kit.hooks.js';
import type { ReactKitProps } from './types.js';
import type { ImplementedComponentName } from '../kit.spec.js';
type RefTargets = { Button: HTMLButtonElement; IconButton: HTMLButtonElement; TextField: HTMLInputElement;
  TextArea: HTMLTextAreaElement; Select: HTMLSelectElement; Checkbox: HTMLInputElement; Switch: HTMLInputElement; Dialog: HTMLDialogElement };
function control<K extends keyof RefTargets>(required: { name: K }, _optional: Record<string, never> = {}) {
  const Facade = forwardRef<RefTargets[K], ReactKitProps[K]>(function KitFacade(props, ref) {
    const vm = useFacade({ name: required.name, props: { ...props, ref } as ReactKitProps[K] });
    const container = useOverlayContainer({});
    const result = createElement(vm.Component, vm.props as Attributes & ReactKitProps[K]);
    return required.name === 'Dialog' ? renderOverlay({ children: result, container }) : result;
  });
  Facade.displayName = required.name;
  return Facade;
}
function view<K extends Exclude<ImplementedComponentName, keyof RefTargets | 'ConfirmDialog'>>(required: { name: K }, _optional: Record<string, never> = {}) {
  function Facade(props: ReactKitProps[K], _optional: Record<string, never> = {}) {
    const vm = useFacade({ name: required.name, props });
    return createElement(vm.Component, vm.props as Attributes & ReactKitProps[K]);
  }
  Facade.displayName = required.name;
  return Facade;
}
export const Button = control({ name: 'Button' });
export const IconButton = control({ name: 'IconButton' });
export const TextField = control({ name: 'TextField' });
export const TextArea = control({ name: 'TextArea' });
export const Select = control({ name: 'Select' });
export const Checkbox = control({ name: 'Checkbox' });
export const Switch = control({ name: 'Switch' });
export const Dialog = control({ name: 'Dialog' });
export const Tabs = view({ name: 'Tabs' });
export const Menu = view({ name: 'Menu' });
export const Toast = view({ name: 'Toast' });
export const Tooltip = view({ name: 'Tooltip' });
export const Notice = view({ name: 'Notice' });
export const Spinner = view({ name: 'Spinner' });
export const Badge = view({ name: 'Badge' });
