import type { ReactNode } from 'react';
import type { KitProviderProps, ToastProps } from './types.js';
import type { ToastService } from '../toast.js';
import { KitContext } from './context.js';
import { useKitProvider, useToastRegion, renderOverlay } from './Kit.hooks.js';
export function KitProvider(props: KitProviderProps, _optional: Record<string, never> = {}) {
  const value = useKitProvider(props);
  return <KitContext.Provider value={value}>{props.children}</KitContext.Provider>;
}
export function Overlay(props: { children: ReactNode; container: HTMLElement | null }, _optional: Record<string, never> = {}) {
  return renderOverlay(props);
}
export function ToastRegion(props: { service?: ToastService; attrs?: ToastProps['attrs'] }, _optional: Record<string, never> = {}) {
  const vm = useToastRegion(props);
  return <Overlay container={vm.container}><div {...vm.attrs} aria-live="polite" aria-relevant="additions removals">{vm.children}</div></Overlay>;
}
