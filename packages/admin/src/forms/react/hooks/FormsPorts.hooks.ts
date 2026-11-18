import { createContext, useContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { AdminConfigError } from '@jini-ai/core/admin-runtime';
import type { AdminFormsPort, FormsCatalogPort, FormsTrashPort, FormsEventsPort, FormsNavigationPort } from '../../ports.js';
import type { FormsTranslator } from '../../models.js';
import { translateForms } from '../../messages.en.js';
import type { UseAdminController } from '@jini-ai/core/contracts/admin-module';
export interface FormsPorts {
  readonly formsApi: AdminFormsPort;
  readonly formsCatalog: FormsCatalogPort;
  readonly formsTrash: FormsTrashPort;
  readonly formsEvents?: FormsEventsPort;
  readonly formsNavigation?: FormsNavigationPort;
}
export interface FormsReactOptions {
  t?: FormsTranslator;
  locale?: string;
  adminBase?: string;
  clipboard?: { writeText(text: string): Promise<void> };
  headerActions?: ReactNode;
  slots?: { RecipientLabel?: ComponentType<{ count: number }> };
}
export const FormsPortsContext = createContext<FormsPorts | null>(null);
export const FormsOptionsContext = createContext<FormsReactOptions>({});
export function useFormsPorts(_required: Record<string, never> = {}, _optional = {}): FormsPorts {
  const ports = useContext(FormsPortsContext);
  if (!ports) throw new AdminConfigError({ issues: ['React scope unavailable: forms'] });
  return ports;
}
export function useFormsOptions(_required: Record<string, never> = {}, _optional = {}) {
  const options = useContext(FormsOptionsContext);
  return { ...options, t: options.t ?? translateForms, locale: options.locale ?? 'en', adminBase: options.adminBase ?? '/admin' };
}
/** The controller hook the host injects through the module factory (owner answer 2026-11-17, J4:
 * injected, never imported). The factory's Provider supplies it; outside it a hook fails loudly. */
export const FormsControllerContext = createContext<UseAdminController | null>(null);
function controllerMissing(): never {
  throw new AdminConfigError({ issues: ['Controller hook unavailable: forms'] });
}
export const useFormsController: UseAdminController = (required, optional = {}) => {
  const useController = useContext(FormsControllerContext) ?? controllerMissing;
  return useController(required, optional);
};
