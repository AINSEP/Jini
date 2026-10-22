import { createContext, useContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { ScopedPorts } from '../../../core/module/types.js';
import type { widgetsModule } from '../../widgets.module.js';
import type { AdminWidgetType, WidgetTypeOption, WidgetSlugRedirectPath, WidgetsTranslate } from '../../models.js';
import { widgetsEnglish } from '../../messages.en.js';
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
