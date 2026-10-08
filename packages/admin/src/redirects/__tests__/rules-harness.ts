/** Test-only calling-convention bridge; all decisions execute the extracted pure rules. */
import type { AdminRedirect } from '../../core/ports/redirects.js';
import * as rules from '../rules.js';
import type { RedirectsTranslate } from '../models.js';
export type LegacyRedirect = Omit<AdminRedirect, 'statusCode'> & { workspaceId?: string; statusCode: number };
export const KEYS = { list: rules.KEYS.list, hits: (redirectId: string) => rules.KEYS.hits({ redirectId }) };
export const REDIRECTS_RESOURCE = rules.REDIRECTS_RESOURCE;
export const nextRedirectStatus = (currentStatus: string) => rules.nextRedirectStatus({ currentStatus });
export const buildCreateRedirectPayload = (form: FormData) => rules.buildCreateRedirectPayload({ form });
export const firstWriteError = (writes: readonly rules.WriteState[]) => rules.firstWriteError({ writes });
export const isAnyWritePending = (writes: readonly rules.WriteState[]) => rules.isAnyWritePending({ writes });
export const visibleRedirectsError = rules.visibleRedirectsError;
export const parseImportPayload = (raw: string, translate: RedirectsTranslate) => rules.parseImportPayload({ raw, translate });
export type WriteState = rules.WriteState;
export function redirectRowMenuItems(rule: LegacyRedirect, handlers: { onToggleStatus: (rule: LegacyRedirect) => void; onRequestDelete: (rule: LegacyRedirect) => void }, locale: string) {
  // This is the translated host contract supplied through t, not a package-owned dictionary.
  const spanish: Record<string, string> = { Disable: 'Desactivar', Enable: 'Activar', Delete: 'Eliminar' };
  return rules.redirectRowMenuItems({ rule: rule as AdminRedirect, handlers }, { t: key => locale === 'es' ? spanish[key] ?? key : key });
}
