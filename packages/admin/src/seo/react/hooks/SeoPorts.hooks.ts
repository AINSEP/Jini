import { createContext, useContext } from 'react';
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
import type { AdminSeoPort, SeoEventsPort } from '../../ports.js';
import type { MediaPickerPort } from '../../../contracts/media-picker.js';
import type { SeoReactOptions } from '../options.js';
import type { UseAdminController } from '@jini-ai/core/contracts/admin-module';
export interface SeoPorts { readonly seoApi: AdminSeoPort; readonly seoEvents?: SeoEventsPort; readonly mediaPicker?: MediaPickerPort }
export const SeoPortsContext = createContext<SeoPorts | null>(null);
export const SeoOptionsContext = createContext<SeoReactOptions | null>(null);
export function useSeoPorts(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): SeoPorts {
  const ports = useContext(SeoPortsContext);
  if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: seo'] });
  return ports;
}
export function useSeoOptions(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): SeoReactOptions {
  const options = useContext(SeoOptionsContext);
  if (!options) throw new AdminConfigError({ issues: ['React options unavailable: seo (siteUrl is required)'] });
  return options;
}
/** The legacy markup's locale argument is metadata only; translation is injected by the host. */
export function useSeoCopy(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const { t = key => key } = useSeoOptions();
  return (required: { locale?: string; key: string; vars?: Record<string, string | number> }) => t(required.key, required.vars);
}
/** The controller hook the host injects through the module factory (owner answer 2026-11-17, J4:
 * injected, never imported). The factory's Provider supplies it; outside it a hook fails loudly. */
export const SeoControllerContext = createContext<UseAdminController | null>(null);
function controllerMissing(): never {
  throw new AdminConfigError({ issues: ['Controller hook unavailable: seo'] });
}
export const useSeoController: UseAdminController = (required, optional = {}) => {
  const useController = useContext(SeoControllerContext) ?? controllerMissing;
  return useController(required, optional);
};
