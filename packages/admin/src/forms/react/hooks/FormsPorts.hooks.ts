import { createContext, useContext } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { AdminConfigError } from '../../../core/module/create-admin.js';
import type { AdminFormsPort, FormsTrashPort, FormsEventsPort, FormsNavigationPort } from '../../ports.js';
import type { FormsTranslator } from '../../models.js';
import { translateForms } from '../../messages.en.js';
export interface FormsPorts {
  readonly formsApi: AdminFormsPort;
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
