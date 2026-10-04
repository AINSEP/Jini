import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, createElement } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { KitContext } from './context.js';
import { createKit } from './kit.js';
import { assertKitContract, KitConfigError } from '../needs.js';
import { kitSpec, type ImplementedComponentName } from '../kit.spec.js';
import type { KitContextValue, KitProviderProps, ReactKitProps, ToastProps } from './types.js';
import { createToastService } from '../toast.js';
import { Toast } from './facade.js';
let defaultValue: KitContextValue | undefined;
function getDefault() {
  return defaultValue ??= { kit: createKit({}), agent: undefined, overlayContainer: null, toast: undefined, cancelLabel: 'Cancel', guard: 'fallback' };
}
export function useKit(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): KitContextValue {
  return useContext(KitContext) ?? getDefault();
}
export function useKitProvider(required: KitProviderProps, _optional: Record<string, never> = {}) {
  const fallback = useMemo(() => createKit({}), []);
  const kit = required.kit ?? fallback;
  for (const requirement of required.needs ?? []) {
    assertKitContract({ contract: requirement.contract });
    const missing = requirement.components.filter(name => kitSpec[name]?.status !== 'implemented');
    if (missing.length) throw new KitConfigError({ issues: missing.map(name => `${requirement.id}: ${name} is not implemented`) });
  }
  const overlayContainer = useOverlayRoot({ supplied: required.overlayContainer });
  const toast = useMemo(() => required.toast ?? createToastService({}), [required.toast]);
  const activeServices = useRef(new Set<typeof toast>());
  useEffect(() => {
    activeServices.current.add(toast);
    return () => {
      activeServices.current.delete(toast);
      // StrictMode immediately replays effects using the same instance. Defer owned-service disposal
      // by one microtask so the replay can reclaim it; replaced or unmounted instances still dispose.
      queueMicrotask(() => { if (!required.toast && !activeServices.current.has(toast)) toast.dispose({}); });
    };
  }, [toast, required.toast]);
  return useMemo<KitContextValue>(() => ({ kit, overlayContainer, toast, agent: required.agent,
    cancelLabel: required.cancelLabel ?? 'Cancel', guard: required.guard ?? kit.guard }),
  [kit, overlayContainer, toast, required.agent, required.cancelLabel, required.guard]);
}
function useOverlayRoot(required: { supplied: HTMLElement | undefined }) {
  const [root, setRoot] = useState<HTMLElement | null>(required.supplied ?? null);
  useEffect(() => {
    if (required.supplied) { setRoot(required.supplied); return; }
    const element = document.createElement('div'); element.dataset.jiniPart = 'kit.overlay'; document.body.appendChild(element);
    setRoot(element);
    return () => { element.remove(); };
  }, [required.supplied]);
  return required.supplied ?? root;
}
export function useOverlayContainer(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  return useKit({}).overlayContainer ?? (typeof document === 'undefined' ? null : document.body);
}
export function renderOverlay(required: { children: ReactNode; container: HTMLElement | null }, _optional: Record<string, never> = {}) {
  return required.container ? createPortal(required.children, required.container) : required.children;
}
export function useKitComponent<K extends ImplementedComponentName>(required: { name: K }, _optional: Record<string, never> = {}) {
  const context = useKit({});
  return context.kit.components[required.name];
}
export function useFacade<K extends Exclude<ImplementedComponentName, 'ConfirmDialog'>>(required: { name: K; props: ReactKitProps[K] }, _optional: Record<string, never> = {}) {
  const Component = useKitComponent({ name: required.name });
  const attrs = { 'data-jini-part': required.name === 'Tabs' ? 'kit.tab' : kitSpec[required.name].parts[0], ...required.props.attrs };
  return { Component, props: { ...required.props, attrs } };
}
export function useToast(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const service = useKit({}).toast;
  if (!service) throw new KitConfigError({ issues: ['useToast requires a KitProvider or an injected toast service'] });
  return service;
}
export function useToastRegion(required: { service?: ReturnType<typeof createToastService>; attrs?: ToastProps['attrs'] }, _optional: Record<string, never> = {}) {
  const context = useKit({});
  const service = required.service ?? context.toast;
  if (!service) throw new KitConfigError({ issues: ['ToastRegion requires a KitProvider or a service'] });
  const messages = useSyncExternalStore(listener => service.subscribe({ listener }), () => service.snapshot({}), () => service.snapshot({}));
  const children = messages.map(message => createElement(Toast, { key: message.id, message: message.message,
    ...(message.tone ? { tone: message.tone } : {}), onDismiss: () => service.dismiss({ id: message.id }) }));
  return { container: useOverlayContainer({}), attrs: { 'data-jini-part': 'kit.toast-region', ...required.attrs }, children };
}
