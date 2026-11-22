import { createContext, useContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { ScopedPorts } from '@jini-ai/core/contracts/admin-module';
import type { widgetsModule } from '../../widgets.module.js';
import type { AdminWidgetType, WidgetTypeOption, WidgetSlugRedirectPath, WidgetsTranslate } from '../../models.js';
import { widgetsEnglish } from '../../messages.en.js';
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
import type { UseAdminController } from '@jini-ai/core/contracts/admin-module';
export interface WidgetsSlots {
  ConfigFields: ComponentType<{ widgetType: AdminWidgetType; config: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; agentHandle?: string | undefined; t?: WidgetsTranslate | undefined }>;
  AddControl: ComponentType<{ triggerLabel: string; onResolved: (id: string) => void; agentHandle?: string | undefined }>;
}
/** Shared config UI/catalog/defaults and slug policy stay host-owned. Locale is presentation metadata. */
export interface WidgetsReactOptions {
  slots: WidgetsSlots;
  widgetTypes: readonly WidgetTypeOption[];
  defaultConfig: (type: AdminWidgetType) => Record<string, unknown>;
  t?: WidgetsTranslate | undefined;
  locale?: string | undefined;
  slugRedirectPath?: WidgetSlugRedirectPath | undefined;
  headerActions?: ReactNode | undefined;
  /** Bind the host serverLabel owner when protocol values have a separate dictionary. */
  statusLabel?: WidgetsTranslate | undefined;
  navigationBase?: string | undefined;
}
export const WidgetsPortsContext = createContext<ScopedPorts<typeof widgetsModule> | null>(null);
export const WidgetsOptionsContext = createContext<WidgetsReactOptions | null>(null);
export function useWidgetsPorts(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const ports = useContext(WidgetsPortsContext);
  if (!ports) throw new Error('React scope unavailable: widgets');
  return ports;
}
export function useWidgetsOptions(_required: Record<string, never> = {}, _optional: Record<string, never> = {}) {
  const options = useContext(WidgetsOptionsContext);
  if (!options) throw new Error('React options unavailable: widgets');
  return { ...options, t: options.t ?? widgetsEnglish, locale: options.locale ?? 'en' };
}
/** The controller hook the host injects through the module factory (owner answer 2026-11-17, J4:
 * injected, never imported). The factory's Provider supplies it; outside it a hook fails loudly. */
export const WidgetsControllerContext = createContext<UseAdminController | null>(null);
function controllerMissing(): never {
  throw new AdminConfigError({ issues: ['Controller hook unavailable: widgets'] });
}
export const useWidgetsController: UseAdminController = (required, optional = {}) => {
  const useController = useContext(WidgetsControllerContext) ?? controllerMissing;
  return useController(required, optional);
};
