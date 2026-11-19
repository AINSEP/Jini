import { useEffect, type ReactNode } from 'react';
import { createConsoleLogger } from '@jini-ai/core';
import type { KitProviderProps, ToastProps } from './types.js';
import { Toast } from './facade.js';
import type { ToastService } from '../toast.js';
import { KitContext, sharedKitContextState, isDevelopment } from './context.js';
import { useKitProvider, useToastRegion, renderOverlay } from './Kit.hooks.js';
export function KitProvider({ useKitProviderHook = useKitProvider, ...props }: KitProviderProps & { useKitProviderHook?: typeof useKitProvider }, _optional: Record<string, never> = {}) {
  const value = useKitProviderHook(props);
  useEffect(() => {
    if (!isDevelopment({})) return;
    const versions = [...sharedKitContextState.versions];
    const reported = sharedKitContextState.reportedVersions ??= new Set<string>();
    for (const version of versions.slice(1)) {
      if (reported.has(version)) continue;
      reported.add(version);
      const logger = value.report ?? createConsoleLogger({ prefix: '@jini-ai/ui-kit' });
      logger.warn({ message: 'Version skew detected; sharing contract-major 1 context.' }, { meta: { versions } });
    }
  });
  return <KitContext.Provider value={value}>{props.children}</KitContext.Provider>;
}
export function Overlay(props: { children: ReactNode; container: HTMLElement | null }, _optional: Record<string, never> = {}) {
  return renderOverlay(props);
}
export function ToastRegion({ useToastRegionHook = useToastRegion, ...props }: { service?: ToastService; attrs?: ToastProps['attrs'] } & { useToastRegionHook?: typeof useToastRegion }, _optional: Record<string, never> = {}) {
  const vm = useToastRegionHook(props);
  return <Overlay container={vm.container}><div {...vm.attrs} aria-live="polite" aria-relevant="additions removals">{vm.messages.map(message => <Toast key={message.id} message={message.message}
    {...(message.tone ? { tone: message.tone } : {})} onDismiss={() => vm.service.dismiss({ id: message.id })} />)}</div></Overlay>;
}
